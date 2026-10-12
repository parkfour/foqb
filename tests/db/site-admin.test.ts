import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

async function makeSiteAdmin(client: Client, userId: string): Promise<void> {
  await client.query("insert into site_admins (user_id) values ($1)", [userId]);
}

describe("site admin", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await client.query("BEGIN");
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("bootstraps the very first user on the instance as a site admin", async () => {
    // Simulate a fresh instance: wipe every existing user (including this
    // suite's global seed row) within this test's own transaction only —
    // rolled back afterward, invisible to every other test. TRUNCATE
    // (unlike DELETE) skips row-level triggers, so this doesn't trip the
    // last-site-admin-removal guard on the seed admin being wiped here.
    await client.query("truncate table auth.users cascade");

    const first = await createUser(client, "first@example.com");
    const { rows } = await client.query("select 1 from site_admins where user_id = $1", [first]);
    expect(rows).toHaveLength(1);

    const second = await createUser(client, "second@example.com");
    const { rows: secondRows } = await client.query(
      "select 1 from site_admins where user_id = $1",
      [second],
    );
    expect(secondRows).toHaveLength(0);
  });

  // Reproduces a real failure: deleting the sole site admin — exactly the
  // state of a first-and-only test signup on a fresh instance, since the
  // bootstrap trigger above auto-promotes them — used to fail with
  // "Cannot remove the last Site Admin" instead of actually deleting the
  // user.
  it("deleting the sole site admin (via user deletion) doesn't need a second admin first", async () => {
    await client.query("truncate table auth.users cascade");
    const solo = await createUser(client, "solo-admin@example.com");
    const { rows: before } = await client.query("select 1 from site_admins where user_id = $1", [
      solo,
    ]);
    expect(before).toHaveLength(1);

    await expect(client.query("delete from auth.users where id = $1", [solo])).resolves.toBeDefined();

    const { rows: after } = await client.query("select 1 from site_admins where user_id = $1", [
      solo,
    ]);
    expect(after).toHaveLength(0);
  });

  it("blocks a non-site-admin from reading other orgs or writing to site_admins", async () => {
    const orgA = await createOrg(client, "Org A");
    const orgB = await createOrg(client, "Org B");
    const user = await createUser(client);
    await addMember(client, orgA, user);

    await asUser(client, user);

    const { rows } = await client.query("select id from organizations");
    expect(rows.map((r) => r.id)).toEqual([orgA]);
    expect(rows.map((r) => r.id)).not.toContain(orgB);

    await client.query("SAVEPOINT sp1");
    await expect(
      client.query("insert into site_admins (user_id) values ($1)", [user]),
    ).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT sp1");

    await client.query("SAVEPOINT sp2");
    await expect(
      client.query("select set_organization_status($1, 'suspended')", [orgA]),
    ).rejects.toThrow(/Only a Site Admin/);
    await client.query("ROLLBACK TO SAVEPOINT sp2");
  });

  it("lets a site admin see every organization and suspend/unsuspend one", async () => {
    const orgA = await createOrg(client, "Org A");
    const orgB = await createOrg(client, "Org B");
    const admin = await createUser(client, "admin@example.com");
    await makeSiteAdmin(client, admin);

    await asUser(client, admin);

    const { rows } = await client.query("select id from organizations order by name");
    expect(rows.map((r) => r.id).sort()).toEqual([orgA, orgB].sort());

    await client.query("select set_organization_status($1, 'suspended')", [orgA]);
    const { rows: statusRows } = await client.query(
      "select status from organizations where id = $1",
      [orgA],
    );
    expect(statusRows[0].status).toBe("suspended");

    await client.query("select set_organization_status($1, 'active')", [orgA]);
    const { rows: reactivated } = await client.query(
      "select status from organizations where id = $1",
      [orgA],
    );
    expect(reactivated[0].status).toBe("active");
  });

  it("suspending an org keeps the owner's read access but drops it for accountants/viewers, and blocks writes even for the owner", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client, "owner@example.com");
    const accountant = await createUser(client, "accountant@example.com");
    const viewer = await createUser(client, "viewer@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, accountant, "accountant");
    await addMember(client, orgId, viewer, "viewer");
    const accountId = await createAccount(client, orgId);

    const admin = await createUser(client, "admin@example.com");
    await makeSiteAdmin(client, admin);
    await asUser(client, admin);
    await client.query("select set_organization_status($1, 'suspended')", [orgId]);
    await client.query("RESET ROLE");

    await asUser(client, owner);
    const { rows: ownerRows } = await client.query("select id from accounts");
    expect(ownerRows.map((r) => r.id)).toEqual([accountId]);
    await expect(
      client.query("update accounts set name = 'Renamed' where id = $1", [accountId]),
    ).resolves.toBeDefined();
    const { rows: afterUpdate } = await client.query("select name from accounts where id = $1", [
      accountId,
    ]);
    // RLS silently filters the update rather than erroring (same pattern as
    // a viewer's blocked write elsewhere in this app).
    expect(afterUpdate[0].name).not.toBe("Renamed");
    await client.query("RESET ROLE");

    await asUser(client, accountant);
    const { rows: accountantRows } = await client.query("select id from accounts");
    expect(accountantRows).toHaveLength(0);
    await client.query("RESET ROLE");

    await asUser(client, viewer);
    const { rows: viewerRows } = await client.query("select id from accounts");
    expect(viewerRows).toHaveLength(0);
  });

  it("lets a site admin delete an organization that has accounts and journal entries (the original bug)", async () => {
    const orgId = await createOrg(client);
    const accountId = await createAccount(client, orgId);
    const entryId = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
      [entryId, orgId],
    );
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 10, 0)",
      [entryId, accountId],
    );

    const admin = await createUser(client, "admin@example.com");
    await makeSiteAdmin(client, admin);
    await asUser(client, admin);

    await expect(
      client.query("select delete_organization($1)", [orgId]),
    ).resolves.toBeDefined();

    // The audit_log FK is deferred (checked at commit, not immediately) —
    // this test never commits, so without forcing it here a dangling
    // reference would pass silently instead of proving the fix works.
    await expect(
      client.query("set constraints audit_log_organization_id_fkey immediate"),
    ).resolves.toBeDefined();

    await client.query("RESET ROLE");
    const { rows } = await client.query("select id from organizations where id = $1", [orgId]);
    expect(rows).toHaveLength(0);
    const { rows: auditRows } = await client.query(
      "select id from audit_log where organization_id = $1",
      [orgId],
    );
    expect(auditRows).toHaveLength(0);
  });

  it("blocks removing the last site admin", async () => {
    // Isolate to exactly one site admin for this test (the suite's global
    // seed admin would otherwise make this a no-op check) — disabling the
    // trigger just for this reset, since deleting the seed admin here would
    // otherwise legitimately trip the same guard this test is verifying.
    await client.query("alter table site_admins disable trigger trg_prevent_last_site_admin_removal");
    await client.query("delete from site_admins");
    await client.query("alter table site_admins enable trigger trg_prevent_last_site_admin_removal");
    const admin = await createUser(client, "lone-admin@example.com");
    await makeSiteAdmin(client, admin);

    await asUser(client, admin);
    await expect(
      client.query("delete from site_admins where user_id = $1", [admin]),
    ).rejects.toThrow(/last Site Admin/);
  });
});

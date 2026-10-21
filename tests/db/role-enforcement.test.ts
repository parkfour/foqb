import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("role enforcement (viewer is read-only)", () => {
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

  it("lets a viewer read accounts but not create one", async () => {
    const orgId = await createOrg(client);
    const viewer = await createUser(client);
    await addMember(client, orgId, viewer, "viewer");
    const existingAccount = await createAccount(client, orgId);

    await asUser(client, viewer);

    const { rows } = await client.query("select id from accounts");
    expect(rows.map((r) => r.id)).toEqual([existingAccount]);

    await expect(
      client.query(
        "insert into accounts (organization_id, account_number, name, type) values ($1, '9999', 'Blocked', 'asset')",
        [orgId],
      ),
    ).rejects.toThrow();
  });

  it("blocks a viewer from updating or deleting an account", async () => {
    const orgId = await createOrg(client);
    const viewer = await createUser(client);
    await addMember(client, orgId, viewer, "viewer");
    const accountId = await createAccount(client, orgId);

    await asUser(client, viewer);

    await client.query("update accounts set name = 'Renamed' where id = $1", [accountId]);
    const { rows } = await client.query("select name from accounts where id = $1", [accountId]);
    // RLS silently filters the row out of the update rather than erroring —
    // assert the name did NOT change.
    expect(rows[0].name).not.toBe("Renamed");

    await client.query("delete from accounts where id = $1", [accountId]);
    const { rows: afterDelete } = await client.query("select id from accounts where id = $1", [
      accountId,
    ]);
    expect(afterDelete).toHaveLength(1);
  });

  it("lets an accountant write, matching an owner", async () => {
    const orgId = await createOrg(client);
    const accountant = await createUser(client);
    await addMember(client, orgId, accountant, "accountant");

    await asUser(client, accountant);

    await expect(
      client.query(
        "insert into accounts (organization_id, account_number, name, type) values ($1, '1000', 'Cash', 'asset')",
        [orgId],
      ),
    ).resolves.toBeDefined();
  });

  it("blocks a viewer from posting journal entries and lines", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client, "owner@example.com");
    await addMember(client, orgId, owner, "owner");
    const cash = await createAccount(client, orgId, { accountNumber: "1000" });

    const viewer = await createUser(client, "viewer@example.com");
    await addMember(client, orgId, viewer, "viewer");

    await asUser(client, viewer);

    await client.query("SAVEPOINT sp1");
    await expect(
      client.query(
        "insert into journal_entries (organization_id, entry_date, status) values ($1, current_date, 'draft')",
        [orgId],
      ),
    ).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT sp1");

    // A viewer also can't add lines to an entry an owner already created.
    await client.query("RESET ROLE");
    const entryId = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
      [entryId, orgId],
    );

    await asUser(client, viewer);
    await expect(
      client.query(
        "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, 10, 0)",
        [entryId, cash],
      ),
    ).rejects.toThrow();
  });

  it("blocks a viewer from managing organization members but allows an owner", async () => {
    const orgId = await createOrg(client);
    const owner = await createUser(client, "owner2@example.com");
    await addMember(client, orgId, owner, "owner");
    const viewer = await createUser(client, "viewer2@example.com");
    await addMember(client, orgId, viewer, "viewer");
    const newUser = await createUser(client, "new@example.com");

    await asUser(client, viewer);
    await client.query("SAVEPOINT sp1");
    await expect(
      client.query(
        "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'viewer')",
        [orgId, newUser],
      ),
    ).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT sp1");

    await client.query("RESET ROLE");
    await asUser(client, owner);
    await expect(
      client.query(
        "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'viewer')",
        [orgId, newUser],
      ),
    ).resolves.toBeDefined();
  });

  it("still allows a user to self-insert their first organization_members row (bootstrap)", async () => {
    const orgId = await createOrg(client);
    const newUser = await createUser(client);

    await asUser(client, newUser);
    await expect(
      client.query(
        "insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')",
        [orgId, newUser],
      ),
    ).resolves.toBeDefined();
  });
});

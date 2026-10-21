import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

async function makeSiteAdmin(client: Client, userId: string): Promise<void> {
  await client.query("insert into site_admins (user_id) values ($1)", [userId]);
}

describe("site admin action logging", () => {
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

  it("logs suspend and unsuspend", async () => {
    const orgId = await createOrg(client, "Logged Org");
    const admin = await createUser(client, "admin@example.com");
    await makeSiteAdmin(client, admin);

    await asUser(client, admin);
    await client.query("select set_organization_status($1, 'suspended')", [orgId]);
    await client.query("select set_organization_status($1, 'active')", [orgId]);

    const { rows } = await client.query(
      "select action, organization_name from site_admin_actions where organization_id = $1 order by created_at",
      [orgId],
    );
    expect(rows).toEqual([
      { action: "suspend", organization_name: "Logged Org" },
      { action: "unsuspend", organization_name: "Logged Org" },
    ]);
  });

  it("logs delete with organization_name and former_member_ids surviving the org's removal", async () => {
    const orgId = await createOrg(client, "Doomed Org");
    const owner = await createUser(client, "doomed-owner@example.com");
    await addMember(client, orgId, owner, "owner");
    const admin = await createUser(client, "admin2@example.com");
    await makeSiteAdmin(client, admin);

    await asUser(client, admin);
    await client.query("select delete_organization($1)", [orgId]);
    await client.query("RESET ROLE");

    const { rows } = await client.query(
      "select action, organization_name, former_member_ids, organization_id from site_admin_actions where organization_name = $1",
      ["Doomed Org"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("delete");
    expect(rows[0].former_member_ids).toEqual([owner]);
    // organization_id is "on delete set null" — the org itself is gone.
    expect(rows[0].organization_id).toBeNull();
  });

  it("logs promote and demote via the site_admins trigger", async () => {
    const admin = await createUser(client, "admin3@example.com");
    await makeSiteAdmin(client, admin);
    const newAdmin = await createUser(client, "new-admin@example.com");

    await asUser(client, admin);
    await client.query("insert into site_admins (user_id, granted_by) values ($1, $2)", [
      newAdmin,
      admin,
    ]);
    await client.query("delete from site_admins where user_id = $1", [newAdmin]);

    const { rows } = await client.query(
      "select action, site_admin_id, target_user_id from site_admin_actions where target_user_id = $1 order by created_at",
      [newAdmin],
    );
    expect(rows).toEqual([
      { action: "promote", site_admin_id: admin, target_user_id: newAdmin },
      { action: "demote", site_admin_id: admin, target_user_id: newAdmin },
    ]);
  });

  it("shows a deleted-org notice only to a former member, not to an unrelated user", async () => {
    const orgId = await createOrg(client, "Notice Org");
    const owner = await createUser(client, "notice-owner@example.com");
    await addMember(client, orgId, owner, "owner");
    const admin = await createUser(client, "admin4@example.com");
    await makeSiteAdmin(client, admin);
    const bystander = await createUser(client, "bystander@example.com");

    await asUser(client, admin);
    await client.query("select delete_organization($1)", [orgId]);
    await client.query("RESET ROLE");

    await asUser(client, owner);
    const { rows: ownerNotices } = await client.query("select organization_name from get_my_deleted_org_notices()");
    expect(ownerNotices.map((r) => r.organization_name)).toContain("Notice Org");
    await client.query("RESET ROLE");

    await asUser(client, bystander);
    const { rows: bystanderNotices } = await client.query(
      "select organization_name from get_my_deleted_org_notices()",
    );
    expect(bystanderNotices.map((r) => r.organization_name)).not.toContain("Notice Org");
  });

  it("restores a deleted organization from a snapshot with the same ids and data intact", async () => {
    const orgId = await createOrg(client, "Restore Me");
    const cashId = await createAccount(client, orgId, {
      accountNumber: "1000",
      name: "Cash",
      type: "asset",
    });
    // Status stays 'draft' — the balance-verification trigger only fires on
    // 'posted', and this test is only checking that the line survives a
    // delete+restore round trip intact, not posting semantics.
    const entryId = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
      [entryId, orgId],
    );
    const lineId = newId();
    await client.query(
      "insert into journal_lines (id, journal_entry_id, account_id, debit, credit) values ($1, $2, $3, 250, 0)",
      [lineId, entryId, cashId],
    );

    // Built directly in SQL (rather than via the app's TS export code) so
    // this test exercises restore_organization()'s contract in isolation —
    // same nested shape lib/org/export-snapshot.ts produces.
    const { rows: snapshotRows } = await client.query(
      `select jsonb_build_object(
         'organization', (select jsonb_build_object('id', id, 'name', name) from organizations where id = $1),
         'accounts', (select coalesce(jsonb_agg(a), '[]'::jsonb) from accounts a where organization_id = $1),
         'journal_entries', (
           select coalesce(jsonb_agg(
             jsonb_build_object(
               'id', je.id, 'organization_id', je.organization_id, 'entry_date', je.entry_date,
               'memo', je.memo, 'status', je.status, 'created_by', je.created_by, 'created_at', je.created_at,
               'journal_lines', (select coalesce(jsonb_agg(jl), '[]'::jsonb) from journal_lines jl where jl.journal_entry_id = je.id)
             )
           ), '[]'::jsonb)
           from journal_entries je where je.organization_id = $1
         ),
         'customers', '[]'::jsonb, 'vendors', '[]'::jsonb, 'invoices', '[]'::jsonb, 'bills', '[]'::jsonb,
         'invoice_payments', '[]'::jsonb, 'bill_payments', '[]'::jsonb, 'items', '[]'::jsonb,
         'inventory_items', '[]'::jsonb, 'fixed_assets', '[]'::jsonb, 'recurring_invoices', '[]'::jsonb,
         'recurring_bills', '[]'::jsonb, 'bank_transactions', '[]'::jsonb, 'bank_reconciliations', '[]'::jsonb,
         'categorization_rules', '[]'::jsonb
       ) as snapshot`,
      [orgId],
    );
    const snapshot = snapshotRows[0].snapshot as unknown;

    const admin = await createUser(client, "restore-admin@example.com");
    await makeSiteAdmin(client, admin);
    await asUser(client, admin);
    await client.query("select delete_organization($1)", [orgId]);
    await client.query("RESET ROLE");

    const { rows: goneRows } = await client.query("select id from organizations where id = $1", [
      orgId,
    ]);
    expect(goneRows).toHaveLength(0);

    const restorer = await createUser(client, "restorer@example.com");
    await asUser(client, restorer);
    const { rows: restoreRows } = await client.query("select restore_organization($1) as id", [
      JSON.stringify(snapshot),
    ]);
    expect(restoreRows[0].id).toBe(orgId);

    const { rows: accountRows } = await client.query(
      "select account_number, name, type from accounts where organization_id = $1",
      [orgId],
    );
    expect(accountRows).toEqual([{ account_number: "1000", name: "Cash", type: "asset" }]);

    const { rows: lineRows } = await client.query(
      "select debit, credit from journal_lines where account_id = $1",
      [cashId],
    );
    expect(Number(lineRows[0].debit)).toBe(250);

    const { rows: memberRows } = await client.query(
      "select role from organization_members where organization_id = $1 and user_id = $2",
      [orgId, restorer],
    );
    expect(memberRows[0].role).toBe("owner");
  });
});

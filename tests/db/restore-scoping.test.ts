import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createOrg, createUser, newId } from "./helpers";

const EMPTY_SECTIONS = {
  accounts: [],
  journal_entries: [],
  customers: [],
  vendors: [],
  invoices: [],
  bills: [],
  invoice_payments: [],
  bill_payments: [],
  items: [],
  inventory_items: [],
  fixed_assets: [],
  recurring_invoices: [],
  recurring_bills: [],
  bank_transactions: [],
  bank_reconciliations: [],
  categorization_rules: [],
};

describe("restore_organization scoping", () => {
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

  it("puts every row in the restored org, ignoring organization_id / parent ids in the file", async () => {
    const victimOrg = await createOrg(client, "Victim");
    const victimOwner = await createUser(client, "victim@example.com");
    await addMember(client, victimOrg, victimOwner, "owner");
    const victimEntry = newId();
    await client.query(
      "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, current_date, 'draft')",
      [victimEntry, victimOrg],
    );

    const newOrgId = newId();
    const accountId = newId();
    const entryId = newId();
    const snapshot = {
      ...EMPTY_SECTIONS,
      organization: { id: newOrgId, name: "Attacker" },
      accounts: [
        { id: accountId, organization_id: victimOrg, account_number: "9999", name: "Injected", type: "asset", is_active: true },
      ],
      customers: [{ id: newId(), organization_id: victimOrg, name: "Injected Customer", is_active: true, created_at: "2026-01-01T00:00:00Z" }],
      journal_entries: [
        {
          id: entryId,
          organization_id: victimOrg,
          entry_date: "2026-01-01",
          status: "draft",
          created_at: "2026-01-01T00:00:00Z",
          journal_lines: [
            { id: newId(), journal_entry_id: victimEntry, account_id: accountId, debit: 5, credit: 0 },
          ],
        },
      ],
    };

    const attacker = await createUser(client, "attacker@example.com");
    await asUser(client, attacker);
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    const { rows: victimAccounts } = await client.query(
      "select id from accounts where organization_id = $1",
      [victimOrg],
    );
    expect(victimAccounts).toHaveLength(0);

    const { rows: victimCustomers } = await client.query(
      "select id from customers where organization_id = $1",
      [victimOrg],
    );
    expect(victimCustomers).toHaveLength(0);

    const { rows: victimLines } = await client.query(
      "select id from journal_lines where journal_entry_id = $1",
      [victimEntry],
    );
    expect(victimLines).toHaveLength(0);

    const { rows: restored } = await client.query(
      `select a.organization_id as account_org, je.organization_id as entry_org, jl.journal_entry_id
         from accounts a, journal_entries je, journal_lines jl
        where a.id = $1 and je.id = $2 and jl.account_id = $1`,
      [accountId, entryId],
    );
    expect(restored).toEqual([{ account_org: newOrgId, entry_org: newOrgId, journal_entry_id: entryId }]);
  });

  it("still restores a legitimate org's own account", async () => {
    const orgId = newId();
    const snapshot = {
      ...EMPTY_SECTIONS,
      organization: { id: orgId, name: "Legit" },
      accounts: [{ id: newId(), organization_id: orgId, account_number: "1000", name: "Cash", type: "asset", is_active: true }],
    };

    const user = await createUser(client, "legit@example.com");
    await asUser(client, user);
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    const { rows } = await client.query("select name from accounts where organization_id = $1", [orgId]);
    expect(rows).toEqual([{ name: "Cash" }]);
  });
});


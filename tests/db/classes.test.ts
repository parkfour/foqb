import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("classes (20260101000089)", () => {
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

  const post = "select post_journal_entry($1, '2026-10-01', 'Sale', $2::jsonb) as id";

  it("posts lines with their class, refuses another book's class, and reports by class", async () => {
    const org = await createOrg(client);
    const other = await createOrg(client, "Other");
    const owner = await createUser(client, "class-owner@example.com");
    await addMember(client, org, owner, "owner");
    const cash = await createAccount(client, org, { type: "asset", name: "Cash" });
    const sales = await createAccount(client, org, { type: "revenue", name: "Sales" });
    const theirs = newId();
    await client.query("insert into classes (id, organization_id, name) values ($1, $2, 'Theirs')", [theirs, other]);

    await asUser(client, owner);
    const east = newId();
    await client.query("insert into classes (id, organization_id, name) values ($1, $2, 'East')", [east, org]);
    await client.query(post, [
      org,
      JSON.stringify([
        { account_id: cash, debit: 150, credit: 0 },
        { account_id: sales, debit: 0, credit: 100, class_id: east },
        { account_id: sales, debit: 0, credit: 50 },
      ]),
    ]);
    expect(
      (await client.query("select class_id, amount::float from get_income_statement_by_class($1, '2026-01-01', '2026-12-31') order by class_id nulls last", [org])).rows,
    ).toEqual([
      { class_id: east, amount: 100 },
      { class_id: null, amount: 50 },
    ]);

    await client.query("SAVEPOINT s");
    await expect(
      client.query(post, [org, JSON.stringify([{ account_id: cash, debit: 1, credit: 0 }, { account_id: sales, debit: 0, credit: 1, class_id: theirs }])]),
    ).rejects.toThrow(/same organization/);
    await client.query("ROLLBACK TO SAVEPOINT s");
  });

  it("restores classes and each line's class", async () => {
    const orgId = newId();
    const [cash, sales, east, entry] = [newId(), newId(), newId(), newId()];
    const snapshot = {
      organization: { id: orgId, name: "Restored Classes" },
      accounts: [
        { id: cash, organization_id: orgId, account_number: "1000", name: "Cash", type: "asset", is_active: true },
        { id: sales, organization_id: orgId, account_number: "4000", name: "Sales", type: "revenue", is_active: true },
      ],
      classes: [{ id: east, name: "East", is_active: true }],
      journal_entries: [
        { id: entry, organization_id: orgId, entry_date: "2026-10-01", memo: "Sale", status: "posted", journal_lines: [
          { id: newId(), journal_entry_id: entry, account_id: cash, debit: 10, credit: 0 },
          { id: newId(), journal_entry_id: entry, account_id: sales, debit: 0, credit: 10, class_id: east },
        ] },
      ],
      customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [], inventory_items: [],
      fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
    };
    await asUser(client, await createUser(client, "class-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");
    expect((await client.query("select class_id from journal_lines where journal_entry_id = $1 and class_id is not null", [entry])).rows).toEqual([
      { class_id: east },
    ]);
  });
});

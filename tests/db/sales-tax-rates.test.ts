import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("sales tax rates (20260101000077)", () => {
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

  async function fails(sql: string, params: unknown[]): Promise<string> {
    await client.query("SAVEPOINT attempt");
    try {
      await client.query(sql, params);
      return "";
    } catch (err) {
      return (err as Error).message;
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT attempt");
    }
  }

  const insertRate = "insert into sales_tax_rates (organization_id, name, rate, account_id) values ($1, $2, $3, $4)";

  it("lets writers add rates, refuses viewers, other books' accounts and impossible rates", async () => {
    const org = await createOrg(client);
    const other = await createOrg(client, "Other");
    const owner = await createUser(client, "tax-owner@example.com");
    const viewer = await createUser(client, "tax-viewer@example.com");
    await addMember(client, org, owner, "owner");
    await addMember(client, org, viewer, "viewer");
    const payable = await createAccount(client, org, { name: "State sales tax payable", type: "liability" });
    const elsewhere = await createAccount(client, other, { name: "Theirs", type: "liability" });

    await asUser(client, owner);
    await client.query(insertRate, [org, "State", 6.25, payable]);
    expect(await fails(insertRate, [org, "City", 2, elsewhere])).toMatch(/same organization/);
    expect(await fails(insertRate, [org, "Zero", 0, null])).toMatch(/check constraint/);
    expect(await fails(insertRate, [org, "State", 1, null])).toMatch(/duplicate key/);

    await client.query("RESET ROLE");
    await asUser(client, viewer);
    expect((await client.query("select name from sales_tax_rates")).rows).toEqual([{ name: "State" }]);
    expect(await fails(insertRate, [org, "County", 1, null])).toMatch(/row-level security/);
  });

  it("restores rates and each invoice's taxes from a backup", async () => {
    const orgId = newId();
    const ar = newId();
    const sales = newId();
    const payable = newId();
    const rate = newId();
    const customer = newId();
    const invoice = newId();
    const entry = newId();
    const snapshot = {
      organization: { id: orgId, name: "Restored Store" },
      accounts: [
        { id: ar, organization_id: orgId, account_number: "1200", name: "Accounts Receivable", type: "asset", is_active: true },
        { id: sales, organization_id: orgId, account_number: "4000", name: "Sales", type: "revenue", is_active: true },
        { id: payable, organization_id: orgId, account_number: "2200", name: "State tax payable", type: "liability", is_active: true },
      ],
      sales_tax_rates: [{ id: rate, name: "State", rate: 6.25, account_id: payable, is_active: true }],
      customers: [{ id: customer, organization_id: orgId, name: "Ann", is_active: true }],
      journal_entries: [
        { id: entry, organization_id: orgId, entry_date: "2026-10-01", memo: "Invoice 1", status: "posted", journal_lines: [
          { id: newId(), journal_entry_id: entry, account_id: ar, debit: 106.25, credit: 0 },
          { id: newId(), journal_entry_id: entry, account_id: sales, debit: 0, credit: 100 },
          { id: newId(), journal_entry_id: entry, account_id: payable, debit: 0, credit: 6.25 },
        ] },
      ],
      invoices: [
        { id: invoice, organization_id: orgId, customer_id: customer, invoice_number: "1", invoice_date: "2026-10-01",
          status: "open", journal_entry_id: entry, tax_rate: 6.25, tax_amount: 6.25,
          invoice_lines: [{ id: newId(), invoice_id: invoice, description: "Widget", account_id: sales, quantity: 1, unit_price: 100, amount: 100 }],
          invoice_taxes: [{ id: newId(), invoice_id: invoice, tax_rate_id: rate, name: "State", rate: 6.25, amount: 6.25, account_id: payable }] },
      ],
      vendors: [], bills: [], invoice_payments: [], bill_payments: [], items: [], inventory_items: [], fixed_assets: [],
      recurring_invoices: [], recurring_bills: [], bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
    };

    await asUser(client, await createUser(client, "tax-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    expect((await client.query("select name, rate::text from sales_tax_rates where organization_id = $1", [orgId])).rows).toEqual([
      { name: "State", rate: "6.250" },
    ]);
    expect((await client.query("select tax_rate_id, amount::text, account_id from invoice_taxes where invoice_id = $1", [invoice])).rows).toEqual([
      { tax_rate_id: rate, amount: "6.25", account_id: payable },
    ]);
  });
});

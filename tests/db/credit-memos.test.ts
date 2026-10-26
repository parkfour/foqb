import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createCustomer, createOrg, createUser, newId } from "./helpers";

describe("credit memos (20260101000084)", () => {
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

  // A book with a $100 open invoice to Ann; the caller is its owner.
  async function book() {
    const org = await createOrg(client);
    const owner = await createUser(client, `cm-owner-${newId()}@example.com`);
    await addMember(client, org, owner, "owner");
    const ar = await createAccount(client, org, { name: "Accounts Receivable", type: "asset" });
    const sales = await createAccount(client, org, { name: "Sales", type: "revenue" });
    const ann = await createCustomer(client, org, { name: "Ann" });
    const bob = await createCustomer(client, org, { name: "Bob" });
    const invoice = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date, status, tax_amount) values ($1, $2, $3, '1', '2026-10-01', 'open', 0)",
      [invoice, org, ann],
    );
    await client.query("insert into invoice_lines (invoice_id, account_id, quantity, unit_price, amount) values ($1, $2, 1, 100, 100)", [invoice, sales]);
    await asUser(client, owner);
    return { org, ar, sales, ann, bob, invoice };
  }

  const create =
    "select create_credit_memo($1, $2, $3, '2026-10-05', 'Returned one', $4::jsonb, $5, $6) as id";

  it("posts revenue against receivables and applies the credit as a payment", async () => {
    const b = await book();
    const lines = JSON.stringify([{ account_id: b.sales, description: "Return", amount: 40 }]);
    const { rows } = await client.query(create, [b.org, b.ann, "CM-1", lines, b.ar, b.invoice]);
    const memo = rows[0].id as string;

    const entry = await client.query(
      "select jl.account_id, jl.debit::float, jl.credit::float from credit_memos cm join journal_lines jl on jl.journal_entry_id = cm.journal_entry_id where cm.id = $1 order by jl.debit desc",
      [memo],
    );
    expect(entry.rows).toEqual([
      { account_id: b.sales, debit: 40, credit: 0 },
      { account_id: b.ar, debit: 0, credit: 40 },
    ]);
    expect((await client.query("select status from invoices where id = $1", [b.invoice])).rows).toEqual([{ status: "partial" }]);
    expect((await client.query("select amount::float, credit_memo_id from invoice_payments where invoice_id = $1", [b.invoice])).rows).toEqual([
      { amount: 40, credit_memo_id: memo },
    ]);
    expect(await fails("select apply_credit_memo($1, $2)", [memo, b.invoice])).toMatch(/already been applied/);
  });

  it("keeps an unapplied memo as credit, then pays an invoice off with it", async () => {
    const b = await book();
    const { rows } = await client.query(create, [b.org, b.ann, "CM-2", JSON.stringify([{ account_id: b.sales, amount: 100 }]), b.ar, null]);
    expect((await client.query("select count(*)::int as n from invoice_payments")).rows).toEqual([{ n: 0 }]);

    await client.query("select apply_credit_memo($1, $2)", [rows[0].id, b.invoice]);
    expect((await client.query("select status from invoices where id = $1", [b.invoice])).rows).toEqual([{ status: "paid" }]);
  });

  it("refuses too much credit, another customer's invoice and empty lines", async () => {
    const b = await book();
    expect(await fails(create, [b.org, b.ann, "CM-3", JSON.stringify([{ account_id: b.sales, amount: 150 }]), b.ar, b.invoice])).toMatch(/more than/);
    expect(await fails(create, [b.org, b.bob, "CM-4", JSON.stringify([{ account_id: b.sales, amount: 10 }]), b.ar, b.invoice])).toMatch(/different customers/);
    expect(await fails(create, [b.org, b.ann, "CM-5", "[]", b.ar, null])).toMatch(/at least one line/);
    expect(await fails(create, [b.org, b.ann, "CM-6", JSON.stringify([{ account_id: b.sales, amount: 0 }]), b.ar, null])).toMatch(/positive amount/);
  });

  it("refuses a viewer", async () => {
    const b = await book();
    await client.query("RESET ROLE");
    const viewer = await createUser(client, "cm-viewer@example.com");
    await addMember(client, b.org, viewer, "viewer");
    await asUser(client, viewer);
    expect(await fails(create, [b.org, b.ann, "CM-7", JSON.stringify([{ account_id: b.sales, amount: 10 }]), b.ar, null])).toMatch(/row-level security|permission|Not/);
  });

  it("restores memos, their lines and the payments they made", async () => {
    const orgId = newId();
    const [ar, sales, customer, invoice, entry, memo] = [newId(), newId(), newId(), newId(), newId(), newId()];
    const snapshot = {
      organization: { id: orgId, name: "Restored Credits" },
      accounts: [
        { id: ar, organization_id: orgId, account_number: "1200", name: "Accounts Receivable", type: "asset", is_active: true },
        { id: sales, organization_id: orgId, account_number: "4000", name: "Sales", type: "revenue", is_active: true },
      ],
      customers: [{ id: customer, organization_id: orgId, name: "Ann", is_active: true }],
      journal_entries: [
        { id: entry, organization_id: orgId, entry_date: "2026-10-05", memo: "Credit memo CM-1", status: "posted", journal_lines: [
          { id: newId(), journal_entry_id: entry, account_id: sales, debit: 40, credit: 0 },
          { id: newId(), journal_entry_id: entry, account_id: ar, debit: 0, credit: 40 },
        ] },
      ],
      invoices: [
        { id: invoice, organization_id: orgId, customer_id: customer, invoice_number: "1", invoice_date: "2026-10-01", status: "partial",
          tax_rate: 0, tax_amount: 0, invoice_lines: [{ id: newId(), invoice_id: invoice, account_id: sales, quantity: 1, unit_price: 100, amount: 100 }] },
      ],
      credit_memos: [
        { id: memo, customer_id: customer, memo_number: "CM-1", memo_date: "2026-10-05", reason: null, total: 40, ar_account_id: ar,
          journal_entry_id: entry, credit_memo_lines: [{ id: newId(), credit_memo_id: memo, account_id: sales, description: null, amount: 40 }] },
      ],
      invoice_payments: [
        { id: newId(), organization_id: orgId, invoice_id: invoice, payment_date: "2026-10-05", amount: 40, deposit_account_id: ar,
          journal_entry_id: entry, credit_memo_id: memo },
      ],
      vendors: [], bills: [], bill_payments: [], items: [], inventory_items: [], fixed_assets: [], recurring_invoices: [],
      recurring_bills: [], bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
    };

    await asUser(client, await createUser(client, "cm-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");

    expect((await client.query("select memo_number, total::float from credit_memos where organization_id = $1", [orgId])).rows).toEqual([
      { memo_number: "CM-1", total: 40 },
    ]);
    expect((await client.query("select credit_memo_id from invoice_payments where invoice_id = $1", [invoice])).rows).toEqual([{ credit_memo_id: memo }]);
  });
});

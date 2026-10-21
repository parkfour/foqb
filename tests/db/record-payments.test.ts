import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createCustomer, createOrg, createUser, createVendor, newId } from "./helpers";

describe("record_invoice_payment / record_bill_payment", () => {
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

  async function setup() {
    const orgId = await createOrg(client);
    const userId = await createUser(client, "payer@example.com");
    await addMember(client, orgId, userId, "accountant");
    const cash = await createAccount(client, orgId, { type: "asset", name: "Checking" });
    const ar = await createAccount(client, orgId, { type: "asset", name: "Accounts Receivable" });
    const ap = await createAccount(client, orgId, { type: "liability", name: "Accounts Payable" });
    const revenue = await createAccount(client, orgId, { type: "revenue" });
    const expense = await createAccount(client, orgId, { type: "expense" });
    return { orgId, userId, cash, ar, ap, revenue, expense };
  }

  async function invoice(orgId: string, revenue: string, subtotal: number, tax = 0): Promise<string> {
    const id = newId();
    const customer = await createCustomer(client, orgId);
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date, tax_amount) values ($1, $2, $3, 'INV-1', current_date, $4)",
      [id, orgId, customer, tax],
    );
    await client.query(
      "insert into invoice_lines (invoice_id, account_id, unit_price, amount) values ($1, $2, $3, $3)",
      [id, revenue, subtotal],
    );
    return id;
  }

  async function bill(orgId: string, expense: string, total: number): Promise<string> {
    const id = newId();
    const vendor = await createVendor(client, orgId);
    await client.query(
      "insert into bills (id, organization_id, vendor_id, bill_number, bill_date) values ($1, $2, $3, 'B-1', current_date)",
      [id, orgId, vendor],
    );
    await client.query(
      "insert into bill_lines (bill_id, account_id, unit_price, amount) values ($1, $2, $3, $3)",
      [id, expense, total],
    );
    return id;
  }

  async function bankTx(orgId: string, account: string, amount: number): Promise<string> {
    const { rows } = await client.query(
      `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, amount)
       values ($1, $2, $3, current_date, $4) returning id`,
      [orgId, account, newId(), amount],
    );
    return rows[0].id as string;
  }

  async function payInvoice(invoiceId: string, amount: number | null, account: string | null, ar: string, bank: string | null = null) {
    const { rows } = await client.query(
      "select record_invoice_payment($1, current_date, $2, $3, $4, $5) as result",
      [invoiceId, amount, account, ar, bank],
    );
    return rows[0].result as { id: string; status: string };
  }

  async function expectRejected(run: () => Promise<unknown>, message: RegExp) {
    await client.query("savepoint s");
    await expect(run()).rejects.toThrow(message);
    await client.query("rollback to savepoint s");
  }

  it("records partial then full payment, posting a balanced entry each time", async () => {
    const s = await setup();
    const inv = await invoice(s.orgId, s.revenue, 100, 20);
    await asUser(client, s.userId);

    expect((await payInvoice(inv, 70, s.cash, s.ar)).status).toBe("partial");
    expect((await payInvoice(inv, 50, s.cash, s.ar)).status).toBe("paid");

    const { rows } = await client.query(
      `select coalesce(sum(jl.debit), 0) as debits from journal_lines jl
         join journal_entries je on je.id = jl.journal_entry_id
        where je.organization_id = $1 and jl.account_id = $2 and je.status = 'posted'`,
      [s.orgId, s.cash],
    );
    expect(Number(rows[0].debits)).toBe(120);
  });

  it("rejects a payment over the remaining balance (tax included) and leaves nothing behind", async () => {
    const s = await setup();
    const inv = await invoice(s.orgId, s.revenue, 100, 20);
    await asUser(client, s.userId);

    await expectRejected(() => payInvoice(inv, 121, s.cash, s.ar), /remaining balance of 120\.00/);
    const { rows } = await client.query("select count(*)::int as n from journal_entries where organization_id = $1", [s.orgId]);
    expect(rows[0].n).toBe(0);
  });

  it("uses the bank transaction's amount and account, and won't match it twice", async () => {
    const s = await setup();
    const inv = await invoice(s.orgId, s.revenue, 100);
    const inv2 = await invoice(s.orgId, s.revenue, 100);
    const deposit = await bankTx(s.orgId, s.cash, 75);
    await asUser(client, s.userId);

    const result = await payInvoice(inv, 9999, s.ar, s.ar, deposit);
    const { rows } = await client.query(
      "select amount, deposit_account_id from invoice_payments where id = $1",
      [result.id],
    );
    expect(rows).toEqual([{ amount: "75.00", deposit_account_id: s.cash }]);

    await expectRejected(() => payInvoice(inv2, null, null, s.ar, deposit), /not an available unreconciled deposit/);
  });

  it("rejects a withdrawal as an invoice deposit", async () => {
    const s = await setup();
    const inv = await invoice(s.orgId, s.revenue, 100);
    const withdrawal = await bankTx(s.orgId, s.cash, -20);
    await asUser(client, s.userId);

    await expectRejected(() => payInvoice(inv, null, null, s.ar, withdrawal), /not an available unreconciled deposit/);
  });

  it("pays a bill from a matched withdrawal using its absolute amount", async () => {
    const s = await setup();
    const b = await bill(s.orgId, s.expense, 40);
    const withdrawal = await bankTx(s.orgId, s.cash, -40);
    await asUser(client, s.userId);

    const { rows } = await client.query(
      "select record_bill_payment($1, current_date, null, null, $2, $3) as result",
      [b, s.ap, withdrawal],
    );
    expect(rows[0].result.status).toBe("paid");
    const { rows: bt } = await client.query("select status from bank_transactions where id = $1", [withdrawal]);
    expect(bt[0].status).toBe("matched");
  });

  it("rejects paying an already-paid bill", async () => {
    const s = await setup();
    const b = await bill(s.orgId, s.expense, 40);
    await asUser(client, s.userId);

    await client.query("select record_bill_payment($1, current_date, 40, $2, $3)", [b, s.cash, s.ap]);
    await expectRejected(() => client.query("select record_bill_payment($1, current_date, 1, $2, $3)", [b, s.cash, s.ap]),
      /already paid/,
    );
  });
});

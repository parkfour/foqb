import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createCustomer, createOrg, createUser, createVendor, newId } from "./helpers";

describe("voiding paid invoices and bills (20260101000085)", () => {
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

  async function setup() {
    const org = await createOrg(client);
    const user = await createUser(client, `voider-${newId()}@example.com`);
    await addMember(client, org, user, "accountant");
    const cash = await createAccount(client, org, { type: "asset", name: "Checking" });
    const ar = await createAccount(client, org, { type: "asset", name: "Accounts Receivable" });
    const ap = await createAccount(client, org, { type: "liability", name: "Accounts Payable" });
    const sales = await createAccount(client, org, { type: "revenue", name: "Sales" });
    const supplies = await createAccount(client, org, { type: "expense", name: "Supplies" });
    const customer = await createCustomer(client, org);
    const invoice = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date, tax_amount) values ($1, $2, $3, 'INV-1', '2026-10-01', 0)",
      [invoice, org, customer],
    );
    await client.query("insert into invoice_lines (invoice_id, account_id, unit_price, amount) values ($1, $2, 100, 100)", [invoice, sales]);
    const { rows } = await client.query(
      "insert into bank_transactions (organization_id, account_id, external_transaction_id, date, amount) values ($1, $2, $3, '2026-10-03', 60) returning id",
      [org, cash, newId()],
    );
    return { org, user, cash, ar, ap, sales, supplies, customer, invoice, deposit: rows[0].id as string };
  }

  const status = async (table: string, id: string) => (await client.query(`select status from ${table} where id = $1`, [id])).rows[0].status;

  it("voids a paid invoice: payment entries void, the deposit back in the feed, the credit memo unapplied", async () => {
    const s = await setup();
    await asUser(client, s.user);
    await client.query("select record_invoice_payment($1, '2026-10-03', null, null, $2, $3)", [s.invoice, s.ar, s.deposit]);
    const { rows } = await client.query(
      "select create_credit_memo($1, $2, 'CM-1', '2026-10-04', null, $3::jsonb, $4, $5) as id",
      [s.org, s.customer, JSON.stringify([{ account_id: s.sales, amount: 40 }]), s.ar, s.invoice],
    );
    expect(await status("invoices", s.invoice)).toBe("paid");

    await client.query("select void_invoice($1)", [s.invoice]);

    expect(await status("invoices", s.invoice)).toBe("void");
    expect((await client.query("select count(*)::int as n from invoice_payments where invoice_id = $1", [s.invoice])).rows[0].n).toBe(0);
    expect((await client.query("select status, journal_entry_id from bank_transactions where id = $1", [s.deposit])).rows).toEqual([
      { status: "unreconciled", journal_entry_id: null },
    ]);
    const memoEntry = await client.query(
      "select je.status from credit_memos cm join journal_entries je on je.id = cm.journal_entry_id where cm.id = $1",
      [rows[0].id],
    );
    expect(memoEntry.rows).toEqual([{ status: "posted" }]);
    expect(
      (await client.query("select count(*)::int as n from journal_entries where organization_id = $1 and memo like 'Payment for invoice%' and status = 'posted'", [s.org])).rows[0].n,
    ).toBe(0);
    expect(await fails("select void_invoice($1)", [s.invoice])).toMatch(/already void/);
  });

  it("voids a paid bill and its payment", async () => {
    const s = await setup();
    const vendor = await createVendor(client, s.org);
    const bill = newId();
    await client.query(
      "insert into bills (id, organization_id, vendor_id, bill_number, bill_date) values ($1, $2, $3, 'B-1', '2026-10-01')",
      [bill, s.org, vendor],
    );
    await client.query("insert into bill_lines (bill_id, account_id, unit_price, amount) values ($1, $2, 30, 30)", [bill, s.supplies]);
    await asUser(client, s.user);
    await client.query("select record_bill_payment($1, '2026-10-02', 30, $2, $3)", [bill, s.cash, s.ap]);

    await client.query("select void_bill($1)", [bill]);

    expect(await status("bills", bill)).toBe("void");
    expect((await client.query("select count(*)::int as n from bill_payments where bill_id = $1", [bill])).rows[0].n).toBe(0);
  });

  it("refuses a payment in a locked period, and a viewer", async () => {
    const s = await setup();
    await asUser(client, s.user);
    await client.query("select record_invoice_payment($1, '2026-10-03', 10, $2, $3)", [s.invoice, s.cash, s.ar]);
    await client.query("RESET ROLE");
    await client.query("update organizations set period_lock_date = '2026-10-31' where id = $1", [s.org]);
    await asUser(client, s.user);
    expect(await fails("select void_invoice($1)", [s.invoice])).toMatch(/locked period/);

    await client.query("RESET ROLE");
    await client.query("update organizations set period_lock_date = null where id = $1", [s.org]);
    const viewer = await createUser(client, "void-viewer@example.com");
    await addMember(client, s.org, viewer, "viewer");
    await asUser(client, viewer);
    expect(await fails("select void_invoice($1)", [s.invoice])).toMatch(/not found/);
  });
});

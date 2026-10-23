import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createCustomer, createOrg, createUser, newId } from "./helpers";

describe("bank change review (reopen_blocker / reopen_bank_transaction)", () => {
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

  // A bank-feed transaction matched to its own posted entry, with the bank
  // now reporting a different amount/date.
  async function matchedWithChange() {
    const orgId = await createOrg(client);
    const userId = await createUser(client, "reviewer@example.com");
    await addMember(client, orgId, userId, "accountant");
    const bank = await createAccount(client, orgId, { type: "asset" });
    const expense = await createAccount(client, orgId, { type: "expense" });
    const { rows: bt } = await client.query(
      `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount)
       values ($1, $2, $3, '2026-01-15', 'COFFEE', -42.5) returning id`,
      [orgId, bank, newId()],
    );
    const { rows: entry } = await client.query(
      `select post_journal_entry($1, '2026-01-15', 'COFFEE', $2, $3) as id`,
      [
        orgId,
        JSON.stringify([
          { account_id: expense, debit: 42.5, credit: 0 },
          { account_id: bank, debit: 0, credit: 42.5 },
        ]),
        bt[0].id,
      ],
    );
    await client.query(`update bank_transactions set bank_change = '{"amount": -45, "date": "2026-01-16"}' where id = $1`, [
      bt[0].id,
    ]);
    return { orgId, userId, bank, bankTxId: bt[0].id as string, entryId: entry[0].id as string };
  }

  // As the book's user, as the app asks it (it answers only for their books).
  async function blocker(s: { userId: string; bankTxId: string }): Promise<string | null> {
    await asUser(client, s.userId);
    const { rows } = await client.query(
      "select reopen_blocker(bt) as reason from bank_transactions bt where bt.id = $1",
      [s.bankTxId],
    );
    await client.query("RESET ROLE");
    return rows[0].reason as string | null;
  }

  it("re-opens a bank-feed-only entry: voids it and applies the bank's new amount/date", async () => {
    const s = await matchedWithChange();
    expect(await blocker(s)).toBeNull();

    await asUser(client, s.userId);
    await client.query("select reopen_bank_transaction($1)", [s.bankTxId]);
    await client.query("RESET ROLE");

    const { rows: bt } = await client.query(
      "select status, amount, date::text, journal_entry_id, bank_change from bank_transactions where id = $1",
      [s.bankTxId],
    );
    expect(bt[0]).toEqual({
      status: "unreconciled",
      amount: "-45.00",
      date: "2026-01-16",
      journal_entry_id: null,
      bank_change: null,
    });
    const { rows: je } = await client.query("select status from journal_entries where id = $1", [s.entryId]);
    expect(je[0].status).toBe("void");
  });

  it("answers only for a row in the asker's own books", async () => {
    const s = await matchedWithChange();
    const outsider = await createUser(client, "outsider@example.com");
    // They can't read the row, but could hand the function one built by hand.
    const { rows: copy } = await client.query("select bt::text as row from bank_transactions bt where bt.id = $1", [s.bankTxId]);

    await asUser(client, outsider);
    const { rows } = await client.query("select reopen_blocker($1::bank_transactions) as reason", [copy[0].row]);
    await client.query("RESET ROLE");
    expect(rows[0].reason).toBe("Not in one of your books");
  });

  it("blocks re-opening an entry that's tied to an invoice payment", async () => {
    const s = await matchedWithChange();
    const revenue = await createAccount(client, s.orgId, { type: "revenue" });
    const invoiceId = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date) values ($1, $2, $3, 'INV-1', current_date)",
      [invoiceId, s.orgId, await createCustomer(client, s.orgId)],
    );
    await client.query("insert into invoice_lines (invoice_id, account_id, unit_price, amount) values ($1, $2, 100, 100)", [
      invoiceId,
      revenue,
    ]);
    await client.query(
      "insert into invoice_payments (organization_id, invoice_id, payment_date, amount, deposit_account_id, journal_entry_id) values ($1, $2, current_date, 42.5, $3, $4)",
      [s.orgId, invoiceId, s.bank, s.entryId],
    );

    expect(await blocker(s)).toMatch(/invoice payment/);

    await asUser(client, s.userId);
    await client.query("savepoint s");
    await expect(client.query("select reopen_bank_transaction($1)", [s.bankTxId])).rejects.toThrow(/invoice payment/);
    await client.query("rollback to savepoint s");
    await client.query("RESET ROLE");

    const { rows } = await client.query("select status from journal_entries where id = $1", [s.entryId]);
    expect(rows[0].status).toBe("posted");
  });

  it("blocks re-opening a reconciled entry", async () => {
    const s = await matchedWithChange();
    const { rows: rec } = await client.query(
      "insert into bank_reconciliations (organization_id, account_id, statement_date, statement_ending_balance) values ($1, $2, current_date, 0) returning id",
      [s.orgId, s.bank],
    );
    await client.query("update journal_lines set reconciliation_id = $1 where journal_entry_id = $2", [rec[0].id, s.entryId]);

    expect(await blocker(s)).toMatch(/reconciliation/);
  });

  it("blocks re-opening when the new date falls in a locked period", async () => {
    const s = await matchedWithChange();
    await client.query(`update bank_transactions set bank_change = '{"amount": -45, "date": "2025-12-31"}' where id = $1`, [
      s.bankTxId,
    ]);
    await client.query("update organizations set period_lock_date = '2025-12-31' where id = $1", [s.orgId]);

    expect(await blocker(s)).toMatch(/locked period/);
  });

  it("re-opens a categorized transaction with no bank change, keeping its amount and date", async () => {
    const s = await matchedWithChange();
    await client.query("update bank_transactions set bank_change = null where id = $1", [s.bankTxId]);
    await asUser(client, s.userId);
    await client.query("select reopen_bank_transaction($1)", [s.bankTxId]);
    await client.query("RESET ROLE");

    const { rows } = await client.query(
      "select status, amount, date::text, journal_entry_id from bank_transactions where id = $1",
      [s.bankTxId],
    );
    expect(rows[0]).toEqual({ status: "unreconciled", amount: "-42.50", date: "2026-01-15", journal_entry_id: null });
  });

  it("refuses a viewer", async () => {
    const s = await matchedWithChange();
    const viewer = await createUser(client, "viewer@example.com");
    await addMember(client, s.orgId, viewer, "viewer");
    await asUser(client, viewer);

    // The viewer can see the row but the RLS-guarded void/update fail.
    await expect(client.query("select reopen_bank_transaction($1)", [s.bankTxId])).rejects.toThrow();
  });

  it("answers for many rows at once as the per-row checks do, for the asker's books only", async () => {
    const s = await matchedWithChange();
    const outsider = await createUser(client, "blockers-outsider@example.com");
    const ask = async (userId: string) => {
      await asUser(client, userId);
      const { rows } = await client.query("select * from bank_transaction_blockers($1::uuid[])", [[s.bankTxId]]);
      await client.query("RESET ROLE");
      return rows;
    };

    await asUser(client, s.userId);
    const { rows: perRow } = await client.query(
      "select bt.id, reopen_blocker(bt), recategorize_blocker(bt) from bank_transactions bt where bt.id = $1",
      [s.bankTxId],
    );
    await client.query("RESET ROLE");
    expect(await ask(s.userId)).toEqual(perRow);
    expect(await ask(outsider)).toEqual([]);

    await client.query("SAVEPOINT anon");
    await client.query("SET LOCAL ROLE anon");
    await expect(client.query("select * from bank_transaction_blockers($1::uuid[])", [[s.bankTxId]])).rejects.toThrow(/permission denied/);
    await client.query("ROLLBACK TO SAVEPOINT anon");
  });
});

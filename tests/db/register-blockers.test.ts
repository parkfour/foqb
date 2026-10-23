import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createCustomer, createOrg, createUser, newId } from "./helpers";

// bank_transaction_blockers (20260101000072) answers for many rows at once
// with copies of the per-row checks: for every kind of blocker it must say
// what reopen_blocker and recategorize_blocker say, for the asker's rows only.
describe("bank_transaction_blockers", () => {
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

  it("agrees with the per-row checks for every kind of row, and leaves out other books' rows", async () => {
    const user = await createUser(client, `blockers-${newId()}@example.com`);
    const org = await createOrg(client, "Blockers");
    await addMember(client, org, user, "owner");
    const checking = await createAccount(client, org, { type: "asset" });
    const savings = await createAccount(client, org, { type: "asset" });
    const groceries = await createAccount(client, org, { type: "expense" });
    const dining = await createAccount(client, org, { type: "expense" });
    const revenue = await createAccount(client, org, { type: "revenue" });

    let n = 0;
    const entry = async (date: string, lines: [string, number, number][]) => {
      const id = newId();
      await client.query("insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, $3, 'draft')", [id, org, date]);
      for (const [account, debit, credit] of lines) {
        await client.query("insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, $3, $4)", [id, account, debit, credit]);
      }
      await client.query("update journal_entries set status = 'posted' where id = $1", [id]);
      return id;
    };
    const feedRow = async (account: string, entryId: string | null, amount = -10) => {
      const { rows } = await client.query(
        `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount, status, journal_entry_id)
         values ($1, $2, $3, '2026-03-10', 'Row', $4, $5, $6) returning id`,
        [org, account, `blk-${org}-${++n}`, amount, entryId ? "matched" : "unreconciled", entryId],
      );
      return rows[0].id as string;
    };

    const ids: string[] = [];
    // Categorized to one account: nothing in the way.
    ids.push(await feedRow(checking, await entry("2026-03-10", [[groceries, 10, 0], [checking, 0, 10]])));
    // Not booked yet.
    ids.push(await feedRow(checking, null));
    // A split.
    ids.push(await feedRow(checking, await entry("2026-03-10", [[groceries, 6, 0], [dining, 4, 0], [checking, 0, 10]])));
    // A transfer: both sides on one entry.
    const transfer = await entry("2026-03-10", [[savings, 10, 0], [checking, 0, 10]]);
    ids.push(await feedRow(checking, transfer), await feedRow(savings, transfer, 10));
    // Reconciled.
    const reconciledEntry = await entry("2026-03-10", [[groceries, 10, 0], [checking, 0, 10]]);
    ids.push(await feedRow(checking, reconciledEntry));
    const { rows: rec } = await client.query(
      "insert into bank_reconciliations (organization_id, account_id, statement_date, statement_ending_balance) values ($1, $2, '2026-03-31', 0) returning id",
      [org, checking],
    );
    await client.query("update journal_lines set reconciliation_id = $2 where journal_entry_id = $1 and account_id = $3", [reconciledEntry, rec[0].id, checking]);
    // Tied to an invoice payment.
    const paidEntry = await entry("2026-03-10", [[checking, 10, 0], [revenue, 0, 10]]);
    ids.push(await feedRow(checking, paidEntry, 10));
    const invoice = newId();
    await client.query(
      "insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date) values ($1, $2, $3, 'INV-B1', '2026-03-01')",
      [invoice, org, await createCustomer(client, org)],
    );
    await client.query("insert into invoice_lines (invoice_id, account_id, unit_price, amount) values ($1, $2, 10, 10)", [invoice, revenue]);
    await client.query(
      "insert into invoice_payments (organization_id, invoice_id, payment_date, amount, deposit_account_id, journal_entry_id) values ($1, $2, '2026-03-10', 10, $3, $4)",
      [org, invoice, checking, paidEntry],
    );
    // In a locked period.
    ids.push(await feedRow(checking, await entry("2026-01-10", [[groceries, 10, 0], [checking, 0, 10]])));
    await client.query("update organizations set period_lock_date = '2026-01-31' where id = $1", [org]);

    // Another book's row, asked for alongside.
    const other = await createOrg(client, "Someone else's");
    const otherAccount = await createAccount(client, other, { type: "asset" });
    const { rows: theirs } = await client.query(
      "insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount) values ($1, $2, $3, '2026-03-10', 'Theirs', -5) returning id",
      [other, otherAccount, `blk-other-${other}`],
    );

    await asUser(client, user);
    const perRow = (
      await client.query(
        "select bt.id, reopen_blocker(bt), recategorize_blocker(bt) from bank_transactions bt where bt.id = any($1::uuid[]) order by bt.id",
        [ids],
      )
    ).rows;
    const atOnce = (
      await client.query("select * from bank_transaction_blockers($1::uuid[]) order by id", [[...ids, theirs[0].id]])
    ).rows;

    expect(atOnce).toEqual(perRow);
    expect(atOnce).toHaveLength(ids.length);
    // Each kind really is blocked as expected, so the comparison means something.
    const reasons = atOnce.flatMap((r) => [r.reopen_blocker, r.recategorize_blocker]).join(" | ");
    for (const reason of [/no journal entry/, /split/i, /transfer/, /reconciliation/, /invoice payment/, /locked period/]) {
      expect(reasons).toMatch(reason);
    }
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("start-up assistant (20260101000059)", () => {
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

  type Line = { account_id: string; debit: number; credit: number };

  async function post(orgId: string, date: string, memo: string, lines: Line[], bankTxId: string | null = null) {
    const { rows } = await client.query(`select post_journal_entry($1, $2, $3, $4, $5) as id`, [
      orgId,
      date,
      memo,
      JSON.stringify(lines),
      bankTxId,
    ]);
    return rows[0].id as string;
  }

  async function feedRow(orgId: string, accountId: string, date: string, amount: number): Promise<string> {
    const { rows } = await client.query(
      `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount)
       values ($1, $2, $3, $4, 'ROW', $5) returning id`,
      [orgId, accountId, newId(), date, amount],
    );
    return rows[0].id as string;
  }

  // A book whose checking account starts on Dec 10 (a statement's opening
  // balance) and whose other bank's feed goes back further.
  async function setup() {
    const orgId = await createOrg(client);
    const userId = await createUser(client, "starter@example.com");
    await addMember(client, orgId, userId, "owner");
    const equity = await createAccount(client, orgId, { accountNumber: "3000", type: "equity" });
    const checking = await createAccount(client, orgId, { accountNumber: "1204", name: "Checking", type: "asset" });
    const other = await createAccount(client, orgId, { accountNumber: "1205", name: "Other bank", type: "asset" });
    await post(orgId, "2025-12-10", "Opening balance (statement)", [
      { account_id: checking, debit: 1000, credit: 0 },
      { account_id: equity, debit: 0, credit: 1000 },
    ]);
    return { orgId, userId, equity, checking, other };
  }

  const early = (s: Awaited<ReturnType<typeof setup>>, date: string) =>
    post(s.orgId, date, "Transfer", [
      { account_id: s.other, debit: 500, credit: 0 },
      { account_id: s.checking, debit: 0, credit: 500 },
    ]);

  it("refuses booking an account on or before its start while the assistant runs", async () => {
    const s = await setup();
    await client.query("insert into startup_assistant (organization_id) values ($1)", [s.orgId]);

    await client.query("SAVEPOINT s");
    await expect(early(s, "2025-12-10")).rejects.toThrow(/Checking's books start on .*book this to equity/);
    await client.query("ROLLBACK TO SAVEPOINT s");
    await early(s, "2025-12-11");

    await client.query("update startup_assistant set finished_at = now() where organization_id = $1", [s.orgId]);
    await early(s, "2025-07-10");
  });

  it("moves history before an account's start to equity, keeping the other side's reconciliation", async () => {
    const s = await setup();
    // An old transfer, paired with checking's own old row, and the other
    // bank's side already reconciled.
    const otherRow = await feedRow(s.orgId, s.other, "2025-07-14", 500);
    const checkingRow = await feedRow(s.orgId, s.checking, "2025-07-10", -500);
    const entry = await early(s, "2025-07-10");
    await client.query("update bank_transactions set status = 'matched', journal_entry_id = $1 where id in ($2, $3)", [
      entry,
      otherRow,
      checkingRow,
    ]);
    const { rows: recs } = await client.query(
      `insert into bank_reconciliations (organization_id, account_id, statement_date, statement_ending_balance, status)
       values ($1, $2, '2026-01-12', 500, 'completed') returning id`,
      [s.orgId, s.other],
    );
    await client.query("update journal_lines set reconciliation_id = $1 where journal_entry_id = $2 and account_id = $3", [
      recs[0].id,
      entry,
      s.other,
    ]);
    const waiting = await feedRow(s.orgId, s.checking, "2025-11-01", 80);

    await asUser(client, s.userId);
    const { rows: before } = await client.query("select * from startup_overview($1)", [s.orgId]);
    expect(before.find((r) => r.account_id === s.checking)).toMatchObject({ early_entries: 1, early_rows: 1 });

    const { rows } = await client.query("select startup_clean_up($1) as r", [s.orgId]);
    expect(rows[0].r).toEqual({ moved: 1, kept: 0, ignored: 1 });

    const { rows: old } = await client.query("select status from journal_entries where id = $1", [entry]);
    expect(old[0].status).toBe("void");
    const { rows: moved } = await client.query(
      `select jl.account_id, jl.reconciliation_id from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id
        where je.status = 'posted' and je.memo = 'Transfer' and je.organization_id = $1 order by jl.debit desc`,
      [s.orgId],
    );
    expect(moved).toEqual([
      { account_id: s.other, reconciliation_id: recs[0].id },
      { account_id: s.equity, reconciliation_id: null },
    ]);
    const { rows: bank } = await client.query(
      "select id, status, journal_entry_id from bank_transactions where id in ($1, $2, $3)",
      [otherRow, checkingRow, waiting],
    );
    const byId = Object.fromEntries(bank.map((b) => [b.id, b]));
    expect(byId[checkingRow]).toMatchObject({ status: "ignored", journal_entry_id: null });
    expect(byId[otherRow].journal_entry_id).not.toBe(entry);
    expect(byId[waiting].status).toBe("ignored");

    const { rows: after } = await client.query("select * from startup_overview($1)", [s.orgId]);
    expect(after.find((r) => r.account_id === s.checking)).toMatchObject({ early_entries: 0, early_rows: 0 });
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("recategorizing a bank transaction (20260101000061)", () => {
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

  async function post(orgId: string, lines: Line[], date = "2026-03-05"): Promise<string> {
    const { rows } = await client.query(`select post_journal_entry($1, $2, 'GROCER', $3, null) as id`, [
      orgId,
      date,
      JSON.stringify(lines),
    ]);
    return rows[0].id as string;
  }

  async function feedRow(orgId: string, accountId: string, entry: string, amount = -60): Promise<string> {
    const { rows } = await client.query(
      `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount, status, journal_entry_id)
       values ($1, $2, $3, '2026-03-05', 'GROCER', $4, 'matched', $5) returning id`,
      [orgId, accountId, newId(), amount, entry],
    );
    return rows[0].id as string;
  }

  async function setup() {
    const orgId = await createOrg(client);
    const owner = await createUser(client, "owner@example.com");
    const viewer = await createUser(client, "viewer@example.com");
    await addMember(client, orgId, owner, "owner");
    await addMember(client, orgId, viewer, "viewer");
    const checking = await createAccount(client, orgId, { accountNumber: "1010", name: "Checking", type: "asset" });
    const dining = await createAccount(client, orgId, { accountNumber: "6100", name: "Dining", type: "expense" });
    const groceries = await createAccount(client, orgId, { accountNumber: "6200", name: "Groceries", type: "expense" });
    const entry = await post(orgId, [
      { account_id: dining, debit: 60, credit: 0 },
      { account_id: checking, debit: 0, credit: 60 },
    ]);
    const row = await feedRow(orgId, checking, entry);
    return { orgId, owner, viewer, checking, dining, groceries, entry, row };
  }

  async function reconcile(orgId: string, accountId: string, entry: string): Promise<string> {
    const { rows } = await client.query(
      `insert into bank_reconciliations (organization_id, account_id, statement_date, statement_ending_balance, status)
       values ($1, $2, '2026-03-31', -60, 'completed') returning id`,
      [orgId, accountId],
    );
    await client.query("update journal_lines set reconciliation_id = $1 where journal_entry_id = $2 and account_id = $3", [
      rows[0].id,
      entry,
      accountId,
    ]);
    return rows[0].id as string;
  }

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

  const recategorize = "select recategorize_bank_transaction($1, $2) as id";

  it("moves a reconciled transaction to another category, keeping its reconciliation", async () => {
    const s = await setup();
    const rec = await reconcile(s.orgId, s.checking, s.entry);

    await asUser(client, s.owner);
    const { rows } = await client.query(recategorize, [s.row, s.groceries]);
    const newEntry = rows[0].id as string;

    const { rows: lines } = await client.query(
      "select account_id, debit::float, credit::float, reconciliation_id from journal_lines where journal_entry_id = $1 order by debit desc",
      [newEntry],
    );
    expect(lines).toEqual([
      { account_id: s.groceries, debit: 60, credit: 0, reconciliation_id: null },
      { account_id: s.checking, debit: 0, credit: 60, reconciliation_id: rec },
    ]);
    const { rows: entries } = await client.query("select id, status, entry_date::text, memo from journal_entries where id in ($1, $2)", [
      s.entry,
      newEntry,
    ]);
    expect(entries.find((e) => e.id === s.entry)?.status).toBe("void");
    expect(entries.find((e) => e.id === newEntry)).toMatchObject({ status: "posted", entry_date: "2026-03-05", memo: "GROCER" });
    const { rows: old } = await client.query("select count(*)::int as n from journal_lines where journal_entry_id = $1 and reconciliation_id is not null", [
      s.entry,
    ]);
    expect(old[0].n).toBe(0);
    const { rows: bt } = await client.query("select status, journal_entry_id from bank_transactions where id = $1", [s.row]);
    expect(bt[0]).toEqual({ status: "matched", journal_entry_id: newEntry });
  });

  it("is refused for a viewer, a split, a transfer, a locked period, and the row's own account", async () => {
    const s = await setup();
    await asUser(client, s.viewer);
    expect(await fails(recategorize, [s.row, s.groceries])).toMatch(/can't change this transaction/);
    await client.query("RESET ROLE");

    await asUser(client, s.owner);
    expect(await fails(recategorize, [s.row, s.checking])).toMatch(/another of this book's active accounts/);
    await client.query("RESET ROLE");

    // A split.
    const split = await post(s.orgId, [
      { account_id: s.dining, debit: 40, credit: 0 },
      { account_id: s.groceries, debit: 20, credit: 0 },
      { account_id: s.checking, debit: 0, credit: 60 },
    ]);
    const splitRow = await feedRow(s.orgId, s.checking, split);
    // A transfer between two feeds.
    const savings = await createAccount(client, s.orgId, { accountNumber: "1020", name: "Savings", type: "asset" });
    const transfer = await post(s.orgId, [
      { account_id: savings, debit: 60, credit: 0 },
      { account_id: s.checking, debit: 0, credit: 60 },
    ]);
    const transferRow = await feedRow(s.orgId, s.checking, transfer);
    await feedRow(s.orgId, savings, transfer, 60);

    await asUser(client, s.owner);
    expect(await fails(recategorize, [splitRow, s.dining])).toMatch(/A split/);
    expect(await fails(recategorize, [transferRow, s.dining])).toMatch(/A transfer/);
    await client.query("RESET ROLE");

    await client.query("update organizations set period_lock_date = '2026-03-31' where id = $1", [s.orgId]);
    await asUser(client, s.owner);
    expect(await fails(recategorize, [s.row, s.groceries])).toMatch(/locked period/);
  });

  it("tells the register which rows it can offer, and leaves a row already there alone", async () => {
    const s = await setup();
    await asUser(client, s.owner);
    const { rows } = await client.query("select recategorize_blocker(bt) as b from bank_transactions bt where id = $1", [s.row]);
    expect(rows[0].b).toBeNull();
    const { rows: same } = await client.query(recategorize, [s.row, s.dining]);
    expect(same[0].id).toBe(s.entry);
  });
});

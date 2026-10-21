import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("transfers, re-opening and account types (20260101000057)", () => {
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
    const userId = await createUser(client, "family@example.com");
    await addMember(client, orgId, userId, "owner");
    const checking = await createAccount(client, orgId, { type: "asset" });
    const card = await createAccount(client, orgId, { type: "liability" });
    const groceries = await createAccount(client, orgId, { type: "expense" });
    return { orgId, userId, checking, card, groceries };
  }

  async function feedRow(orgId: string, accountId: string, date: string, amount: number): Promise<string> {
    const { rows } = await client.query(
      `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount)
       values ($1, $2, $3, $4, 'ROW', $5) returning id`,
      [orgId, accountId, newId(), date, amount],
    );
    return rows[0].id as string;
  }

  // Books a feed row to another account, the way the app does.
  async function book(orgId: string, bankTxId: string, from: string, to: string, amount: number): Promise<string> {
    const lines =
      amount < 0
        ? [
            { account_id: to, debit: -amount, credit: 0 },
            { account_id: from, debit: 0, credit: -amount },
          ]
        : [
            { account_id: from, debit: amount, credit: 0 },
            { account_id: to, debit: 0, credit: amount },
          ];
    const { rows } = await client.query(`select post_journal_entry($1, '2026-10-10', 'BOOK', $2, $3) as id`, [
      orgId,
      JSON.stringify(lines),
      bankTxId,
    ]);
    return rows[0].id as string;
  }

  async function row(id: string) {
    const { rows } = await client.query("select status, journal_entry_id from bank_transactions where id = $1", [id]);
    return rows[0] as { status: string; journal_entry_id: string | null };
  }

  it("matches the other side already in the feed when a transfer is booked", async () => {
    const s = await setup();
    const out = await feedRow(s.orgId, s.checking, "2026-10-10", -500);
    const into = await feedRow(s.orgId, s.card, "2026-10-13", 500);

    await asUser(client, s.userId);
    const entry = await book(s.orgId, out, s.checking, s.card, -500);
    await client.query("RESET ROLE");

    expect(await row(into)).toEqual({ status: "matched", journal_entry_id: entry });
    const { rows } = await client.query("select count(*)::int as n from journal_entries where organization_id = $1", [
      s.orgId,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it("matches the other side arriving later to the booked transfer", async () => {
    const s = await setup();
    const out = await feedRow(s.orgId, s.checking, "2026-10-10", -500);
    const entry = await book(s.orgId, out, s.checking, s.card, -500);

    const into = await feedRow(s.orgId, s.card, "2026-10-12", 500);

    expect(await row(into)).toEqual({ status: "matched", journal_entry_id: entry });
  });

  it("leaves rows alone outside the 5-day window or for a different amount", async () => {
    const s = await setup();
    const late = await feedRow(s.orgId, s.card, "2026-10-16", 500);
    const other = await feedRow(s.orgId, s.card, "2026-10-11", 499.99);
    const out = await feedRow(s.orgId, s.checking, "2026-10-10", -500);
    await book(s.orgId, out, s.checking, s.card, -500);

    expect((await row(late)).status).toBe("unreconciled");
    expect((await row(other)).status).toBe("unreconciled");
  });

  it("doesn't treat an ordinary expense as a transfer", async () => {
    const s = await setup();
    const coffee = await feedRow(s.orgId, s.card, "2026-10-10", -4.5);
    await book(s.orgId, coffee, s.card, s.groceries, -4.5);

    const refund = await feedRow(s.orgId, s.checking, "2026-10-10", -4.5);
    expect((await row(refund)).status).toBe("unreconciled");
  });

  it("pairs two identical transfers one to one", async () => {
    const s = await setup();
    const out1 = await feedRow(s.orgId, s.checking, "2026-10-10", -100);
    const out2 = await feedRow(s.orgId, s.checking, "2026-10-10", -100);
    const in1 = await feedRow(s.orgId, s.card, "2026-10-11", 100);
    const in2 = await feedRow(s.orgId, s.card, "2026-10-11", 100);

    const e1 = await book(s.orgId, out1, s.checking, s.card, -100);
    const e2 = await book(s.orgId, out2, s.checking, s.card, -100);

    const entries = [(await row(in1)).journal_entry_id, (await row(in2)).journal_entry_id].sort();
    expect(entries).toEqual([e1, e2].sort());
  });

  it("re-opens both sides of a transfer together", async () => {
    const s = await setup();
    const out = await feedRow(s.orgId, s.checking, "2026-10-10", -500);
    const into = await feedRow(s.orgId, s.card, "2026-10-11", 500);
    const entry = await book(s.orgId, out, s.checking, s.card, -500);

    await asUser(client, s.userId);
    await client.query("select reopen_bank_transaction($1)", [into]);
    await client.query("RESET ROLE");

    expect(await row(out)).toEqual({ status: "unreconciled", journal_entry_id: null });
    expect(await row(into)).toEqual({ status: "unreconciled", journal_entry_id: null });
    const { rows } = await client.query("select status from journal_entries where id = $1", [entry]);
    expect(rows[0].status).toBe("void");
  });

  it("restores an ignored transaction", async () => {
    const s = await setup();
    const id = await feedRow(s.orgId, s.checking, "2026-10-10", -20);
    await client.query("update bank_transactions set status = 'ignored' where id = $1", [id]);

    await asUser(client, s.userId);
    await client.query("select reopen_bank_transaction($1)", [id]);
    await client.query("RESET ROLE");

    expect((await row(id)).status).toBe("unreconciled");
  });

  it("refuses to re-open an uncategorized transaction", async () => {
    const s = await setup();
    const id = await feedRow(s.orgId, s.checking, "2026-10-10", -20);
    await expect(client.query("select reopen_bank_transaction($1)", [id])).rejects.toThrow(/categorized or ignored/);
  });

  it("lets an account change type only while it has no transactions", async () => {
    const s = await setup();
    await client.query("update accounts set type = 'asset' where id = $1", [s.groceries]);
    await client.query("update accounts set type = 'expense' where id = $1", [s.groceries]);

    const coffee = await feedRow(s.orgId, s.card, "2026-10-10", -4.5);
    await book(s.orgId, coffee, s.card, s.groceries, -4.5);

    await expect(client.query("update accounts set type = 'asset' where id = $1", [s.groceries])).rejects.toThrow(
      /can't change type/,
    );
  });
});

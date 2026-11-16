import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser } from "./helpers";

describe("bank transactions on an account in another currency (20260101000100)", () => {
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

  const post = "select post_journal_entry($1, '2026-03-01', 'x', $2::jsonb, $3) as id";

  async function book() {
    const org = await createOrg(client);
    const owner = await createUser(client, "fx-feed@example.com");
    await addMember(client, org, owner, "owner");
    const krw = await createAccount(client, org, { type: "asset", name: "Won account" });
    const food = await createAccount(client, org, { type: "expense", name: "Food" });
    const rent = await createAccount(client, org, { type: "expense", name: "Rent" });
    await client.query("update accounts set currency = 'KRW' where id = $1", [krw]);
    const row = async (amount: number, rate: number | null) =>
      (
        await client.query(
          `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount, exchange_rate)
           values ($1, $2, gen_random_uuid()::text, '2026-03-01', 'Shop', $3, $4) returning id`,
          [org, krw, amount, rate],
        )
      ).rows[0].id as string;
    return { org, owner, krw, food, rent, row };
  }

  it("books a row at its rate: the bank line keeps its won, the category gets dollars", async () => {
    const { org, owner, krw, food, row } = await book();
    const bt = await row(-45000, 0.00072);
    await asUser(client, owner);

    const { id } = (
      await client.query(post, [
        org,
        JSON.stringify([
          { account_id: food, debit: 45000, credit: 0 },
          { account_id: krw, debit: 0, credit: 45000 },
        ]),
        bt,
      ])
    ).rows[0];

    const lines = (
      await client.query(
        "select account_id, debit::float, credit::float, foreign_amount::float, exchange_rate::float from journal_lines where journal_entry_id = $1 order by debit desc",
        [id],
      )
    ).rows;
    expect(lines).toEqual([
      { account_id: food, debit: 32.4, credit: 0, foreign_amount: null, exchange_rate: null },
      { account_id: krw, debit: 0, credit: 32.4, foreign_amount: 45000, exchange_rate: 0.00072 },
    ]);
  });

  it("puts a split's rounding cent on its largest line, so the entry balances", async () => {
    const { org, owner, krw, food, rent, row } = await book();
    // 3 × 0.00333 rounds each third to 0.00 and the whole to 0.01.
    const bt = await row(-3, 0.00333);
    await asUser(client, owner);

    const { id } = (
      await client.query(post, [
        org,
        JSON.stringify([
          { account_id: food, debit: 2, credit: 0 },
          { account_id: rent, debit: 1, credit: 0 },
          { account_id: krw, debit: 0, credit: 3 },
        ]),
        bt,
      ])
    ).rows[0];

    const totals = (
      await client.query("select sum(debit)::float as d, sum(credit)::float as c from journal_lines where journal_entry_id = $1", [id])
    ).rows[0];
    expect(totals.d).toBe(totals.c);
  });

  it("refuses a row worth less than a cent in the book's currency", async () => {
    const { org, owner, krw, food, row } = await book();
    const bt = await row(-5, 0.00072);
    await asUser(client, owner);

    expect(
      await fails(post, [
        org,
        JSON.stringify([
          { account_id: food, debit: 5, credit: 0 },
          { account_id: krw, debit: 0, credit: 5 },
        ]),
        bt,
      ]),
    ).toMatch(/worth less than a cent/);
  });

  it("refuses to book a row with no rate", async () => {
    const { org, owner, krw, food, row } = await book();
    const bt = await row(-45000, null);
    await asUser(client, owner);

    expect(
      await fails(post, [
        org,
        JSON.stringify([
          { account_id: food, debit: 45000, credit: 0 },
          { account_id: krw, debit: 0, credit: 45000 },
        ]),
        bt,
      ]),
    ).toMatch(/Give this KRW transaction an exchange rate/);
  });

  it("keeps a row's class and foreign amount when its category changes (20260101000099)", async () => {
    const { org, owner, krw, food, rent, row } = await book();
    const bt = await row(-45000, 0.00072);
    const cls = (await client.query("insert into classes (organization_id, name) values ($1, 'Seoul') returning id", [org])).rows[0].id;
    await asUser(client, owner);
    await client.query(post, [
      org,
      JSON.stringify([
        { account_id: food, debit: 45000, credit: 0, class_id: cls },
        { account_id: krw, debit: 0, credit: 45000 },
      ]),
      bt,
    ]);

    const { rows } = await client.query("select recategorize_bank_transaction($1, $2) as id", [bt, rent]);
    const lines = (
      await client.query(
        "select account_id, class_id, foreign_amount::float from journal_lines where journal_entry_id = $1 order by debit desc",
        [rows[0].id],
      )
    ).rows;
    expect(lines).toEqual([
      { account_id: rent, class_id: cls, foreign_amount: null },
      { account_id: krw, class_id: null, foreign_amount: 45000 },
    ]);
  });
});

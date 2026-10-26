import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { createAccount, createOrg, newId } from "./helpers";

describe("apply_bank_change (20260101000092)", () => {
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

  // As the feed job does it: no signed-in user. A $42.50 coffee, booked,
  // that the bank now says was $45 the next day.
  async function booked(lines: (bank: string, expense: string, tip: string) => object[], change = { amount: -45, date: "2026-01-16" }) {
    const org = await createOrg(client);
    const bank = await createAccount(client, org, { type: "asset", name: "Checking" });
    const expense = await createAccount(client, org, { type: "expense", name: "Meals" });
    const tip = await createAccount(client, org, { type: "expense", name: "Tips" });
    const { rows: bt } = await client.query(
      "insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount) values ($1, $2, $3, '2026-01-15', 'COFFEE', -42.5) returning id",
      [org, bank, newId()],
    );
    const { rows: entry } = await client.query("select post_journal_entry($1, '2026-01-15', 'COFFEE', $2, $3) as id", [
      org,
      JSON.stringify(lines(bank, expense, tip)),
      bt[0].id,
    ]);
    await client.query("update bank_transactions set bank_change = $2 where id = $1", [bt[0].id, JSON.stringify(change)]);
    return { org, bank, expense, bt: bt[0].id as string, entry: entry[0].id as string };
  }
  const plain = (bank: string, expense: string) => [
    { account_id: expense, debit: 42.5, credit: 0 },
    { account_id: bank, debit: 0, credit: 42.5 },
  ];
  const apply = async (bt: string) => (await client.query("select apply_bank_change($1) as applied", [bt])).rows[0].applied as boolean;

  it("re-books a plain categorized entry at the bank's amount and date", async () => {
    const s = await booked(plain);
    expect(await apply(s.bt)).toBe(true);

    const { rows } = await client.query("select amount::float, date::text, bank_change, journal_entry_id from bank_transactions where id = $1", [s.bt]);
    expect(rows[0]).toMatchObject({ amount: -45, date: "2026-01-16", bank_change: null });
    expect((await client.query("select status from journal_entries where id = $1", [s.entry])).rows[0].status).toBe("void");
    const lines = await client.query(
      "select jl.account_id, jl.debit::float, jl.credit::float, je.entry_date::text, je.status from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id where je.id = $1 order by jl.debit desc",
      [rows[0].journal_entry_id],
    );
    expect(lines.rows).toEqual([
      { account_id: s.expense, debit: 45, credit: 0, entry_date: "2026-01-16", status: "posted" },
      { account_id: s.bank, debit: 0, credit: 45, entry_date: "2026-01-16", status: "posted" },
    ]);
  });

  it("leaves a split, a flipped sign and a locked period held for review", async () => {
    const split = await booked((bank, expense, tip) => [
      { account_id: expense, debit: 40, credit: 0 },
      { account_id: tip, debit: 2.5, credit: 0 },
      { account_id: bank, debit: 0, credit: 42.5 },
    ]);
    expect(await apply(split.bt)).toBe(false);

    const flipped = await booked(plain, { amount: 45, date: "2026-01-16" });
    expect(await apply(flipped.bt)).toBe(false);

    const locked = await booked(plain);
    await client.query("update organizations set period_lock_date = '2026-01-31' where id = $1", [locked.org]);
    expect(await apply(locked.bt)).toBe(false);
    expect((await client.query("select bank_change from bank_transactions where id = $1", [locked.bt])).rows[0].bank_change).not.toBeNull();
  });

  it("keeps the expense line's class (20260101000096)", async () => {
    const s = await booked(plain);
    const { rows: cls } = await client.query("insert into classes (organization_id, name) values ($1, 'Shop') returning id", [s.org]);
    await client.query("update journal_lines set class_id = $2 where journal_entry_id = $1 and account_id <> (select account_id from bank_transactions where id = $3)", [s.entry, cls[0].id, s.bt]);
    expect(await apply(s.bt)).toBe(true);

    const { rows } = await client.query(
      "select jl.class_id from journal_lines jl join bank_transactions bt on bt.journal_entry_id = jl.journal_entry_id where bt.id = $1 and jl.account_id = $2",
      [s.bt, s.expense],
    );
    expect(rows).toEqual([{ class_id: cls[0].id }]);
  });
});

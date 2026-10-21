import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser } from "./helpers";

describe("post_journal_entry", () => {
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
    const userId = await createUser(client, "poster@example.com");
    await addMember(client, orgId, userId, "accountant");
    const cash = await createAccount(client, orgId, { type: "asset" });
    const expense = await createAccount(client, orgId, { type: "expense" });
    return { orgId, userId, cash, expense };
  }

  function lines(debitAccount: string, creditAccount: string, debit: number, credit = debit) {
    return JSON.stringify([
      { account_id: debitAccount, debit, credit: 0 },
      { account_id: creditAccount, debit: 0, credit },
    ]);
  }

  async function entryCount(orgId: string): Promise<number> {
    const { rows } = await client.query("select count(*)::int as n from journal_entries where organization_id = $1", [orgId]);
    return rows[0].n as number;
  }

  it("posts a balanced entry with its lines", async () => {
    const { orgId, userId, cash, expense } = await setup();
    await asUser(client, userId);

    const { rows } = await client.query("select post_journal_entry($1, current_date, 'Coffee', $2) as id", [
      orgId,
      lines(expense, cash, 12.5),
    ]);
    const { rows: entry } = await client.query("select status, created_by from journal_entries where id = $1", [rows[0].id]);
    expect(entry).toEqual([{ status: "posted", created_by: userId }]);
    const { rows: lineRows } = await client.query("select count(*)::int as n from journal_lines where journal_entry_id = $1", [rows[0].id]);
    expect(lineRows[0].n).toBe(2);
  });

  it("leaves nothing behind when the entry doesn't balance", async () => {
    const { orgId, userId, cash, expense } = await setup();
    await asUser(client, userId);

    await client.query("savepoint s");
    await expect(
      client.query("select post_journal_entry($1, current_date, 'Bad', $2)", [orgId, lines(expense, cash, 10, 9)]),
    ).rejects.toThrow();
    await client.query("rollback to savepoint s");
    expect(await entryCount(orgId)).toBe(0);
  });

  it("matches a bank transaction only once", async () => {
    const { orgId, userId, cash, expense } = await setup();
    const { rows: bt } = await client.query(
      `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, amount)
       values ($1, $2, 'ext-1', current_date, -12.5) returning id`,
      [orgId, cash],
    );
    await asUser(client, userId);

    await client.query("select post_journal_entry($1, current_date, 'Coffee', $2, $3)", [orgId, lines(expense, cash, 12.5), bt[0].id]);
    await client.query("savepoint s");
    await expect(
      client.query("select post_journal_entry($1, current_date, 'Coffee', $2, $3)", [orgId, lines(expense, cash, 12.5), bt[0].id]),
    ).rejects.toThrow(/not an available unreconciled/);
    await client.query("rollback to savepoint s");

    expect(await entryCount(orgId)).toBe(1);
    const { rows: status } = await client.query("select status from bank_transactions where id = $1", [bt[0].id]);
    expect(status[0].status).toBe("matched");
  });

  it("refuses a viewer", async () => {
    const { orgId, cash, expense } = await setup();
    const viewer = await createUser(client, "viewer@example.com");
    await addMember(client, orgId, viewer, "viewer");
    await asUser(client, viewer);

    await expect(
      client.query("select post_journal_entry($1, current_date, 'x', $2)", [orgId, lines(expense, cash, 1)]),
    ).rejects.toThrow(/row-level security/);
  });
});

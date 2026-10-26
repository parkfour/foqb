import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

describe("accounts in another currency (20260101000093)", () => {
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

  const post = "select post_journal_entry($1, $2, 'x', $3::jsonb) as id";

  it("needs the foreign amount on a foreign account, and gives its balance in both currencies", async () => {
    const org = await createOrg(client);
    const owner = await createUser(client, "fx-owner@example.com");
    await addMember(client, org, owner, "owner");
    const usd = await createAccount(client, org, { type: "asset", name: "Checking" });
    const eur = await createAccount(client, org, { type: "asset", name: "Euro account" });
    const gain = await createAccount(client, org, { type: "revenue", name: "Exchange gain" });
    await client.query("update accounts set currency = 'EUR' where id = $1", [eur]);

    await asUser(client, owner);
    // 1,000 EUR bought for $1,100.
    await client.query(post, [
      org,
      "2026-03-01",
      JSON.stringify([
        { account_id: eur, debit: 1100, credit: 0, foreign_amount: 1000, exchange_rate: 1.1 },
        { account_id: usd, debit: 0, credit: 1100 },
      ]),
    ]);
    expect(
      await fails(post, [org, "2026-03-02", JSON.stringify([{ account_id: eur, debit: 5, credit: 0 }, { account_id: usd, debit: 0, credit: 5 }])]),
    ).toMatch(/needs its amount in EUR/);
    expect(
      await fails(post, [org, "2026-03-02", JSON.stringify([{ account_id: eur, debit: 5, credit: 0, foreign_amount: 5, exchange_rate: 1 }, { account_id: usd, debit: 0, credit: 5, foreign_amount: 5 }])]),
    ).toMatch(/Only a line on an account in another currency/);
    // Revalued at 1.15: worth $50 more, no euros moved.
    await client.query(post, [
      org,
      "2026-03-31",
      JSON.stringify([
        { account_id: eur, debit: 50, credit: 0, foreign_amount: 0 },
        { account_id: gain, debit: 0, credit: 50 },
      ]),
    ]);

    expect(
      (await client.query("select currency, foreign_balance::float, book_balance::float from get_foreign_balances($1, '2026-12-31')", [org])).rows,
    ).toEqual([{ currency: "EUR", foreign_balance: 1000, book_balance: 1150 }]);

    await client.query("RESET ROLE");
    expect(await fails("update accounts set currency = 'GBP' where id = $1", [eur])).toMatch(/can't change once it has entries/);
    const fees = await createAccount(client, org, { type: "revenue", name: "Fees" });
    expect(await fails("update accounts set currency = 'EUR' where id = $1", [fees])).toMatch(/accounts_currency_balance_sheet/);
  });

  it("restores account currencies and foreign amounts", async () => {
    const orgId = newId();
    const [eur, usd, entry] = [newId(), newId(), newId()];
    const snapshot = {
      organization: { id: orgId, name: "Restored FX", currency: "USD" },
      accounts: [
        { id: eur, organization_id: orgId, account_number: "1010", name: "Euro", type: "asset", is_active: true, currency: "EUR" },
        { id: usd, organization_id: orgId, account_number: "1000", name: "Checking", type: "asset", is_active: true },
      ],
      journal_entries: [
        { id: entry, organization_id: orgId, entry_date: "2026-03-01", memo: "FX", status: "posted", journal_lines: [
          { id: newId(), journal_entry_id: entry, account_id: eur, debit: 110, credit: 0, foreign_amount: 100, exchange_rate: 1.1 },
          { id: newId(), journal_entry_id: entry, account_id: usd, debit: 0, credit: 110 },
        ] },
      ],
      customers: [], vendors: [], invoices: [], bills: [], invoice_payments: [], bill_payments: [], items: [], inventory_items: [],
      fixed_assets: [], recurring_invoices: [], recurring_bills: [], bank_transactions: [], bank_reconciliations: [], categorization_rules: [],
    };
    await asUser(client, await createUser(client, "fx-restorer@example.com"));
    await client.query("select restore_organization($1)", [JSON.stringify(snapshot)]);
    await client.query("RESET ROLE");
    expect((await client.query("select foreign_amount::float, exchange_rate::float from journal_lines where account_id = $1", [eur])).rows).toEqual([
      { foreign_amount: 100, exchange_rate: 1.1 },
    ]);
  });
});

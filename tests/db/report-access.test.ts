import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, asUser, createAccount, createOrg, createUser, newId } from "./helpers";

// The report functions run as the definer (20260101000071): they must give a
// member exactly their book's figures, never another book's, and hold an
// MFA-enrolled user to MFA as the row-level security they skip did.
describe("report functions as a signed-in user", () => {
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

  async function post(orgId: string, date: string, lines: [string, number, number][]) {
    const id = newId();
    await client.query("insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, $3, 'draft')", [id, orgId, date]);
    for (const [account, debit, credit] of lines) {
      await client.query("insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, $3, $4)", [id, account, debit, credit]);
    }
    await client.query("update journal_entries set status = 'posted' where id = $1", [id]);
  }

  // One user in two books. Book A: 1,000 opening cash and 300 of sales on
  // Schedule C line 1. Book B: much bigger numbers, which must never show in A's.
  async function twoBooks() {
    const user = await createUser(client, `two-books-${newId()}@example.com`);
    const [a, b] = [await createOrg(client, "Book A"), await createOrg(client, "Book B")];
    await addMember(client, a, user, "owner");
    await addMember(client, b, user, "owner");
    const { rows } = await client.query("select id from tax_lines where form = 'schedule_c' and code = 'line_1'");
    const salesLine = rows[0].id as string;
    const book = async (org: string, opening: number, sales: number) => {
      const cash = await createAccount(client, org, { type: "asset", accountNumber: "1000", name: "Cash" });
      const equity = await createAccount(client, org, { type: "equity", accountNumber: "3000", name: "Equity" });
      const revenue = await createAccount(client, org, { type: "revenue", accountNumber: "4000", name: "Sales" });
      await client.query("update accounts set tax_line_id = $2 where id = $1", [revenue, salesLine]);
      await post(org, "2026-01-02", [[cash, opening, 0], [equity, 0, opening]]);
      await post(org, "2026-03-15", [[cash, sales, 0], [revenue, 0, sales]]);
      return { cash, revenue };
    };
    const accountsA = await book(a, 1000, 300);
    await book(b, 50000, 9000);
    return { user, a, salesLine, ...accountsA };
  }

  const call = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows;

  it("gives each report the asked-for book's own figures", async () => {
    const s = await twoBooks();
    await asUser(client, s.user);

    const balance = await call("select name, balance::float from get_balance_sheet($1, '2026-12-31')", [s.a]);
    expect(balance).toEqual(
      expect.arrayContaining([
        { name: "Cash", balance: 1300 },
        { name: "Equity", balance: 1000 },
        { name: "Retained Earnings", balance: 300 },
      ]),
    );
    expect(balance).toHaveLength(3);
    expect(await call("select name, amount::float from get_income_statement($1, '2026-01-01', '2026-12-31')", [s.a])).toEqual([
      { name: "Sales", amount: 300 },
    ]);
    const trial = await call("select name, total_debit::float, total_credit::float from get_trial_balance($1, '2026-12-31')", [s.a]);
    expect(trial).toEqual([
      { name: "Cash", total_debit: 1300, total_credit: 0 },
      { name: "Equity", total_debit: 0, total_credit: 1000 },
      { name: "Sales", total_debit: 0, total_credit: 300 },
    ]);
    expect(await call("select debit::float from get_account_ledger($1, $2, null, '2026-12-31')", [s.a, s.cash])).toEqual([
      { debit: 1000 },
      { debit: 300 },
    ]);
    expect(
      await call("select account_id, debit::float, credit::float from get_general_ledger($1, '2026-03-01', '2026-12-31')", [s.a]),
    ).toEqual(
      expect.arrayContaining([
        { account_id: s.cash, debit: 300, credit: 0 },
        { account_id: s.revenue, debit: 0, credit: 300 },
      ]),
    );
    expect(await call("select 1 from get_general_ledger($1, '2026-03-01', '2026-12-31')", [s.a])).toHaveLength(2);
    expect(
      await call("select code, amount::float from get_tax_line_report($1, '2026-01-01', '2026-12-31') where code is not null", [s.a]),
    ).toEqual([{ code: "line_1", amount: 300 }]);
    expect(
      await call("select name, amount::float from get_tax_line_accounts($1, $2, 'revenue', '2026-01-01', '2026-12-31')", [s.a, s.salesLine]),
    ).toEqual([{ name: "Sales", amount: 300 }]);
    expect(
      await call("select as_of::text, total_assets::float from get_net_worth_series($1, array['2026-02-01', '2026-12-31']::date[])", [s.a]),
    ).toEqual([
      { as_of: "2026-02-01", total_assets: 1000 },
      { as_of: "2026-12-31", total_assets: 1300 },
    ]);
  });

  it("holds a user enrolled in MFA to it: refused until verified this session", async () => {
    const s = await twoBooks();
    await client.query("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [s.user]);
    const reports: [string, unknown[]][] = [
      ["select * from get_balance_sheet($1, '2026-12-31')", [s.a]],
      ["select * from get_income_statement($1, '2026-01-01', '2026-12-31')", [s.a]],
      ["select * from get_trial_balance($1, '2026-12-31')", [s.a]],
      ["select * from get_account_ledger($1, $2, null, '2026-12-31')", [s.a, s.cash]],
      ["select * from get_general_ledger($1, '2026-01-01', '2026-12-31')", [s.a]],
      ["select * from get_tax_line_report($1, '2026-01-01', '2026-12-31')", [s.a]],
      ["select * from get_tax_line_accounts($1, $2, 'revenue', '2026-01-01', '2026-12-31')", [s.a, s.salesLine]],
      ["select * from get_net_worth_series($1, array['2026-12-31']::date[])", [s.a]],
    ];

    await asUser(client, s.user); // aal1
    for (const [sql, params] of reports) {
      await client.query("SAVEPOINT r");
      await expect(client.query(sql, params), sql).rejects.toThrow(/Not one of your books/);
      await client.query("ROLLBACK TO SAVEPOINT r");
    }

    await client.query("SET LOCAL request.jwt.claim.aal = 'aal2'");
    for (const [sql, params] of reports) {
      expect((await client.query(sql, params)).rows.length, sql).toBeGreaterThan(0);
    }
  });
});

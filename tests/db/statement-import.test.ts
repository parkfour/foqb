import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { addMember, createAccount, createOrg, createUser, newId } from "./helpers";
import { removeBooks, restClientAs } from "./rest";
import { importStatement, SETTLED_MEMO } from "@/plugins/statement-import/import";
import type { ParsedStatement, StatementRow } from "@/plugins/statement-import/parse";
import { bookOpeningBalances, OPENING_BALANCE_MEMO, STATEMENT_OPENING_MEMO } from "@/lib/bank/opening-balance";

// importStatement through supabase-js against the real schema (PostgREST),
// signed in as the book's owner. Each test has a book of its own, since
// what's written through the API commits.
describe("importStatement", () => {
  let client: Client;
  // What the API wrote committed, so it's removed again for the other test files.
  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    client = new Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  });

  afterAll(async () => {
    await removeBooks(client, orgIds, userIds);
    await client.end();
  });

  async function book() {
    const userId = await createUser(client, `importer-${newId()}@example.com`);
    const orgId = await createOrg(client, "Import Book");
    await addMember(client, orgId, userId, "owner");
    orgIds.push(orgId);
    userIds.push(userId);
    const account = (name: string, type: string, number: string) =>
      createAccount(client, orgId, { name, type, accountNumber: number });
    const ids = {
      checking: await account("Checking", "asset", "1000"),
      savings: await account("Savings", "asset", "1010"),
      equity: await account("Opening Equity", "equity", "3000"),
      coffee: await account("Coffee", "expense", "6000"),
      pay: await account("Wages", "revenue", "4000"),
    };
    // Rules book the sample rows, so a statement can reconcile.
    for (const [text, target] of [["COFFEE", ids.coffee], ["PAYROLL", ids.pay]] as const) {
      await client.query(
        "insert into categorization_rules (organization_id, target_account_id, rule_name, match_type, match_text) values ($1, $2, $3, 'contains', $3)",
        [orgId, target, text],
      );
    }
    return { userId, orgId, ...ids, supabase: restClientAs(userId) };
  }

  function statement(
    periodStart: string,
    periodEnd: string,
    openingBalance: number,
    rows: StatementRow[],
  ): ParsedStatement {
    const closingBalance = Math.round((openingBalance + rows.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
    return { bank: "Test", kind: "deposit", accountName: "Checking", accountLast4: "", periodStart, periodEnd, openingBalance, closingBalance, rows };
  }

  const march = (opening = 1000) =>
    statement("2026-03-01", "2026-03-31", opening, [
      { date: "2026-03-05", description: "COFFEE SHOP", amount: -50 },
      { date: "2026-03-15", description: "PAYROLL", amount: 200 },
    ]);

  async function openings(accountId: string) {
    const { rows } = await client.query(
      `select je.entry_date::text, je.memo, je.status, jl.debit::float, jl.credit::float
         from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id
        where jl.account_id = $1 and je.memo in ($2, $3) order by je.created_at`,
      [accountId, OPENING_BALANCE_MEMO, STATEMENT_OPENING_MEMO],
    );
    return rows;
  }

  async function balance(accountId: string, through: string) {
    const { rows } = await client.query(
      `select coalesce(sum(jl.debit - jl.credit), 0)::float as b
         from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id
        where jl.account_id = $1 and je.status = 'posted' and je.entry_date <= $2`,
      [accountId, through],
    );
    return rows[0].b;
  }

  it("adds the rows, opens the account at the statement's balance, books by rules and reconciles", async () => {
    const b = await book();

    const result = await importStatement(b.supabase, b.orgId, b.userId, b.checking, march());

    expect(result).toMatchObject({ success: true, added: 2, alreadyThere: 0, uncategorized: 0, reconciled: true });
    expect(await openings(b.checking)).toEqual([
      { entry_date: "2026-02-28", memo: STATEMENT_OPENING_MEMO, status: "posted", debit: 1000, credit: 0 },
    ]);
    expect(await balance(b.checking, "2026-03-31")).toBe(1150);
    const { rows } = await client.query(
      "select count(*)::int as n from journal_lines where account_id = $1 and reconciliation_id is null",
      [b.checking],
    );
    expect(rows[0].n).toBe(0);
  });

  it("doesn't add a statement twice while it's still being reconciled", async () => {
    const b = await book();
    const s = statement("2026-03-01", "2026-03-31", 1000, [
      { date: "2026-03-05", description: "COFFEE SHOP", amount: -50 },
      { date: "2026-03-06", description: "MYSTERY", amount: -10 },
    ]);
    await importStatement(b.supabase, b.orgId, b.userId, b.checking, s);

    const again = await importStatement(b.supabase, b.orgId, b.userId, b.checking, s);

    expect(again).toMatchObject({ success: true, added: 0, alreadyThere: 2 });
    const { rows } = await client.query("select count(*)::int as n from bank_transactions where account_id = $1", [b.checking]);
    expect(rows[0].n).toBe(2);
  });

  it("opens at the statement's balance rather than one worked out from the bank, and keeps it", async () => {
    const b = await book();
    // The bank-derived opening a linked account got the day before its feed
    // starts, off while months are missing.
    await client.query(
      `with je as (insert into journal_entries (organization_id, entry_date, memo, status) values ($1, '2026-03-04', $2, 'draft') returning id)
       insert into journal_lines (journal_entry_id, account_id, debit, credit) select id, $3::uuid, 700, 0 from je union all select id, $4::uuid, 0, 700 from je`,
      [b.orgId, OPENING_BALANCE_MEMO, b.checking, b.equity],
    );
    await client.query("update journal_entries set status = 'posted' where organization_id = $1 and memo = $2", [b.orgId, OPENING_BALANCE_MEMO]);

    await importStatement(b.supabase, b.orgId, b.userId, b.checking, march());
    // The bank's balance later works out a different opening again.
    await client.query("update accounts set bank_balance = 5000 where id = $1", [b.checking]);
    await bookOpeningBalances(b.supabase, b.orgId);

    expect(await openings(b.checking)).toEqual([
      { entry_date: "2026-03-04", memo: OPENING_BALANCE_MEMO, status: "void", debit: 700, credit: 0 },
      { entry_date: "2026-02-28", memo: STATEMENT_OPENING_MEMO, status: "posted", debit: 1000, credit: 0 },
    ]);
  });

  it("books no second opening balance for a statement after a reconciled one", async () => {
    const b = await book();
    await importStatement(b.supabase, b.orgId, b.userId, b.checking, march());

    const april = statement("2026-04-01", "2026-04-30", 1150, [{ date: "2026-04-03", description: "COFFEE BAR", amount: -25 }]);
    const result = await importStatement(b.supabase, b.orgId, b.userId, b.checking, april);

    expect(result).toMatchObject({ success: true, reconciled: true });
    expect((await openings(b.checking)).filter((o) => o.status === "posted")).toHaveLength(1);
    expect(await balance(b.checking, "2026-04-30")).toBe(1125);
  });

  it("refuses a statement for a period the account is already reconciled through", async () => {
    const b = await book();
    await importStatement(b.supabase, b.orgId, b.userId, b.checking, march());

    const result = await importStatement(b.supabase, b.orgId, b.userId, b.checking, march());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already reconciled through 2026-03-31/);
  });

  it("moves a feed row dated outside the period into it when the statement posts it there", async () => {
    const b = await book();
    // The feed dated the purchase Feb 27; the statement posts it Mar 2.
    const { rows } = await client.query(
      `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount)
       values ($1, $2, 'feed-1', '2026-02-27', 'COFFEE SHOP', -50) returning id`,
      [b.orgId, b.checking],
    );
    const s = statement("2026-03-01", "2026-03-31", 1000, [{ date: "2026-03-02", description: "COFFEE SHOP", amount: -50 }]);

    const result = await importStatement(b.supabase, b.orgId, b.userId, b.checking, s);

    expect(result).toMatchObject({ success: true, added: 0, alreadyThere: 1 });
    const moved = await client.query("select date::text from bank_transactions where id = $1", [rows[0].id]);
    expect(moved.rows[0].date).toBe("2026-03-02");
  });

  it("keeps a repeat of last month's row: rows aren't matched against an earlier statement", async () => {
    const b = await book();
    const feb = statement("2026-02-01", "2026-02-28", 1000, [{ date: "2026-02-28", description: "COFFEE SHOP", amount: -50 }]);
    await importStatement(b.supabase, b.orgId, b.userId, b.checking, feb);

    const mar = statement("2026-03-01", "2026-03-31", 950, [{ date: "2026-03-01", description: "COFFEE SHOP", amount: -50 }]);
    const result = await importStatement(b.supabase, b.orgId, b.userId, b.checking, mar);

    expect(result).toMatchObject({ success: true, added: 1, reconciled: true });
    expect(await balance(b.checking, "2026-03-31")).toBe(900);
  });

  it("leaves the reconciliation open while a row in the period waits to be categorized", async () => {
    const b = await book();
    const s = statement("2026-03-01", "2026-03-31", 1000, [
      { date: "2026-03-05", description: "COFFEE SHOP", amount: -50 },
      { date: "2026-03-06", description: "MYSTERY", amount: -10 },
    ]);

    const result = await importStatement(b.supabase, b.orgId, b.userId, b.checking, s);

    expect(result).toMatchObject({ success: true, uncategorized: 1, reconciled: false });
    const { rows } = await client.query("select status from bank_reconciliations where account_id = $1", [b.checking]);
    expect(rows).toEqual([{ status: "in_progress" }]);
  });

  it("settles the history before a statement: earlier rows ignored, the difference adjusted, all cleared", async () => {
    const b = await book();
    // Older feed rows: one booked (coffee), one never categorized.
    await client.query(
      `insert into bank_transactions (organization_id, account_id, external_transaction_id, date, name, amount)
       values ($1, $2, 'old-1', '2026-01-10', 'UNKNOWN OLD', -30)`,
      [b.orgId, b.checking],
    );
    // ...and an entry booked before, so the books come to 970, not 1000.
    await client.query(
      `with je as (insert into journal_entries (organization_id, entry_date, memo, status) values ($1, '2026-01-12', 'Old coffee', 'draft') returning id)
       insert into journal_lines (journal_entry_id, account_id, debit, credit) select id, $2::uuid, 30, 0 from je union all select id, $3::uuid, 0, 30 from je`,
      [b.orgId, b.coffee, b.checking],
    );
    await client.query("update journal_entries set status = 'posted' where organization_id = $1 and memo = 'Old coffee'", [b.orgId]);
    const s = march(1000);

    const result = await importStatement(b.supabase, b.orgId, b.userId, b.checking, s, { settleBefore: true });

    expect(result).toMatchObject({ success: true, reconciled: true });
    const old = await client.query("select status from bank_transactions where external_transaction_id = 'old-1' and account_id = $1", [b.checking]);
    expect(old.rows[0].status).toBe("ignored");
    const settled = await client.query(
      "select statement_date::text, status from bank_reconciliations where account_id = $1 order by statement_date",
      [b.checking],
    );
    expect(settled.rows).toEqual([
      { statement_date: "2026-02-28", status: "completed" },
      { statement_date: "2026-03-31", status: "completed" },
    ]);
    expect(await balance(b.checking, "2026-02-28")).toBe(1000);
    // 30 of adjustment against equity brings the 970 booked to the statement's 1000.
    const adjustments = await client.query(
      `select jl.debit::float, jl.credit::float from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id
        where je.organization_id = $1 and je.memo = $2 and jl.account_id = $3`,
      [b.orgId, SETTLED_MEMO, b.checking],
    );
    expect(adjustments.rows).toEqual([{ debit: 30, credit: 0 }]);
  });

  it("finishes the other account's reconciliation when its transfer is booked", async () => {
    const b = await book();
    // Savings' statement first: its transfer in can't be booked yet, so it waits.
    const savings = statement("2026-03-01", "2026-03-31", 0, [{ date: "2026-03-10", description: "TRANSFER FROM CHECKING", amount: 300 }]);
    const first = await importStatement(b.supabase, b.orgId, b.userId, b.savings, { ...savings, accountName: "Savings" });
    expect(first).toMatchObject({ success: true, reconciled: false });

    const checking = statement("2026-03-01", "2026-03-31", 1000, [{ date: "2026-03-10", description: "TRANSFER TO SAVINGS", amount: -300 }]);
    const second = await importStatement(b.supabase, b.orgId, b.userId, b.checking, checking);

    expect(second).toMatchObject({ success: true, reconciled: true, alsoReconciled: [b.savings] });
    const { rows } = await client.query("select status from bank_reconciliations where account_id = $1", [b.savings]);
    expect(rows).toEqual([{ status: "completed" }]);
  });
});

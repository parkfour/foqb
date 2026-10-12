import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { createAccount, createOrg, newId } from "./helpers";

interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
}

async function postEntry(
  client: Client,
  orgId: string,
  entryDate: string,
  lines: JournalLineInput[],
  status: "draft" | "posted" = "posted",
): Promise<string> {
  const entryId = newId();
  await client.query(
    "insert into journal_entries (id, organization_id, entry_date, status) values ($1, $2, $3, 'draft')",
    [entryId, orgId, entryDate],
  );

  for (const line of lines) {
    await client.query(
      "insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1, $2, $3, $4)",
      [entryId, line.accountId, line.debit ?? 0, line.credit ?? 0],
    );
  }

  if (status === "posted") {
    await client.query("update journal_entries set status = 'posted' where id = $1", [entryId]);
  }

  return entryId;
}

interface ReportRow {
  account_id: string | null;
  account_number: string | null;
  name: string;
  type: string;
  balance?: string;
  total_debit?: string;
  total_credit?: string;
  amount?: string;
}

describe("financial reporting RPCs", () => {
  let client: Client;
  let orgId: string;
  let cash: string;
  let capital: string;
  let revenue: string;
  let rentExpense: string;

  beforeAll(async () => {
    client = new Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await client.query("BEGIN");

    orgId = await createOrg(client);
    cash = await createAccount(client, orgId, { accountNumber: "1000", name: "Cash", type: "asset" });
    capital = await createAccount(client, orgId, {
      accountNumber: "3000",
      name: "Capital",
      type: "equity",
    });
    revenue = await createAccount(client, orgId, {
      accountNumber: "4000",
      name: "Revenue",
      type: "revenue",
    });
    rentExpense = await createAccount(client, orgId, {
      accountNumber: "5000",
      name: "Rent Expense",
      type: "expense",
    });

    // Owner investment.
    await postEntry(client, orgId, "2026-01-05", [
      { accountId: cash, debit: 1000 },
      { accountId: capital, credit: 1000 },
    ]);
    // A sale.
    await postEntry(client, orgId, "2026-01-10", [
      { accountId: cash, debit: 500 },
      { accountId: revenue, credit: 500 },
    ]);
    // Rent paid.
    await postEntry(client, orgId, "2026-01-15", [
      { accountId: rentExpense, debit: 200 },
      { accountId: cash, credit: 200 },
    ]);
    // Draft entry — must be excluded from every report.
    await postEntry(
      client,
      orgId,
      "2026-01-20",
      [
        { accountId: cash, debit: 999 },
        { accountId: revenue, credit: 999 },
      ],
      "draft",
    );
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  it("computes trial balance per account and keeps debits equal to credits overall", async () => {
    const { rows } = await client.query<ReportRow>("select * from get_trial_balance($1, $2)", [
      orgId,
      "2026-01-31",
    ]);

    const byAccount = Object.fromEntries(rows.map((r) => [r.account_id, r]));
    expect(Number(byAccount[cash].balance)).toBe(1300);
    expect(Number(byAccount[capital].balance)).toBe(1000);
    expect(Number(byAccount[revenue].balance)).toBe(500);
    expect(Number(byAccount[rentExpense].balance)).toBe(200);

    const totalDebit = rows.reduce((sum, r) => sum + Number(r.total_debit), 0);
    const totalCredit = rows.reduce((sum, r) => sum + Number(r.total_credit), 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("excludes draft entries and dates outside the as-of window", async () => {
    const { rows } = await client.query<ReportRow>("select * from get_trial_balance($1, $2)", [
      orgId,
      "2026-01-09",
    ]);
    const cashRow = rows.find((r) => r.account_id === cash);
    expect(Number(cashRow?.balance)).toBe(1000); // only the Jan 5 entry
  });

  it("computes the income statement for a date range", async () => {
    const { rows } = await client.query<ReportRow>(
      "select * from get_income_statement($1, $2, $3)",
      [orgId, "2026-01-01", "2026-01-31"],
    );
    const byAccount = Object.fromEntries(rows.map((r) => [r.account_id, r]));
    expect(Number(byAccount[revenue].amount)).toBe(500);
    expect(Number(byAccount[rentExpense].amount)).toBe(200);
  });

  it("computes retained earnings as cumulative net income", async () => {
    const { rows } = await client.query<{ retained_earnings: string }>(
      "select get_retained_earnings($1, $2) as retained_earnings",
      [orgId, "2026-01-31"],
    );
    expect(Number(rows[0].retained_earnings)).toBe(300);
  });

  it("balances the balance sheet: assets = liabilities + equity", async () => {
    const { rows } = await client.query<ReportRow>("select * from get_balance_sheet($1, $2)", [
      orgId,
      "2026-01-31",
    ]);

    const totalAssets = rows
      .filter((r) => r.type === "asset")
      .reduce((sum, r) => sum + Number(r.balance), 0);
    const totalLiabilities = rows
      .filter((r) => r.type === "liability")
      .reduce((sum, r) => sum + Number(r.balance), 0);
    const totalEquity = rows
      .filter((r) => r.type === "equity")
      .reduce((sum, r) => sum + Number(r.balance), 0);

    expect(totalAssets).toBe(1300);
    expect(totalLiabilities).toBe(0);
    expect(totalEquity).toBe(1300);
    expect(totalAssets).toBe(totalLiabilities + totalEquity);

    const retainedEarningsRow = rows.find((r) => r.name === "Retained Earnings");
    expect(retainedEarningsRow).toBeDefined();
    expect(Number(retainedEarningsRow?.balance)).toBe(300);
    expect(retainedEarningsRow?.account_id).toBeNull();
  });

  it("computes the tax line report, grouping untagged accounts into an Unassigned bucket", async () => {
    const { rows: taxLineRows } = await client.query<{ id: string }>(
      "select id from tax_lines where form = 'schedule_c' and code = 'line_1'",
    );
    const grossReceiptsLine = taxLineRows[0].id;
    // revenue is tagged; rentExpense is deliberately left untagged.
    await client.query("update accounts set tax_line_id = $1 where id = $2", [
      grossReceiptsLine,
      revenue,
    ]);

    const { rows } = await client.query<{
      tax_line_id: string | null;
      code: string | null;
      label: string;
      account_type: string;
      amount: string;
    }>("select * from get_tax_line_report($1, $2, $3)", [orgId, "2026-01-01", "2026-01-31"]);

    const taggedRow = rows.find((r) => r.tax_line_id === grossReceiptsLine);
    expect(taggedRow?.code).toBe("line_1");
    expect(Number(taggedRow?.amount)).toBe(500);

    const unassignedExpense = rows.find(
      (r) => r.tax_line_id === null && r.account_type === "expense",
    );
    expect(unassignedExpense?.label).toBe("Unassigned Expense");
    expect(Number(unassignedExpense?.amount)).toBe(200);
  });

  it("drills down from a tax line to the accounts behind it", async () => {
    const { rows: taxLineRows } = await client.query<{ id: string }>(
      "select id from tax_lines where form = 'schedule_c' and code = 'line_1'",
    );
    const grossReceiptsLine = taxLineRows[0].id;
    await client.query("update accounts set tax_line_id = $1 where id = $2", [
      grossReceiptsLine,
      revenue,
    ]);

    const { rows: tagged } = await client.query<{ account_id: string; amount: string }>(
      "select * from get_tax_line_accounts($1, $2, $3, $4, $5)",
      [orgId, grossReceiptsLine, "revenue", "2026-01-01", "2026-01-31"],
    );
    expect(tagged).toHaveLength(1);
    expect(tagged[0].account_id).toBe(revenue);
    expect(Number(tagged[0].amount)).toBe(500);

    // rentExpense was never tagged — it should show up under the
    // "Unassigned" expense bucket (p_tax_line_id null).
    const { rows: unassigned } = await client.query<{ account_id: string; amount: string }>(
      "select * from get_tax_line_accounts($1, null, $2, $3, $4)",
      [orgId, "expense", "2026-01-01", "2026-01-31"],
    );
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].account_id).toBe(rentExpense);
    expect(Number(unassigned[0].amount)).toBe(200);
  });

  it("returns an account's posted ledger lines in date order, excluding drafts", async () => {
    const { rows } = await client.query<{ entry_date: Date; debit: string; credit: string }>(
      "select * from get_account_ledger($1, $2, null, $3)",
      [orgId, cash, "2026-01-31"],
    );

    // Three posted entries touch cash (the Jan-20 entry is a draft and must
    // be excluded); the 999-amount draft entry would stand out immediately
    // if the status filter ever regressed.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.entry_date.toISOString().slice(0, 10))).toEqual([
      "2026-01-05",
      "2026-01-10",
      "2026-01-15",
    ]);
    expect(Number(rows[2].credit)).toBe(200);
  });

  it("filters the account ledger by start date when one is given", async () => {
    const { rows } = await client.query(
      "select * from get_account_ledger($1, $2, $3, $4)",
      [orgId, cash, "2026-01-10", "2026-01-31"],
    );
    expect(rows).toHaveLength(2); // Jan-5 entry falls before the start date
  });
});

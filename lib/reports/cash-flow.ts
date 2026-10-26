import { createClient } from "@/lib/supabase/server";
import { fetchTrialBalance, type TrialBalanceRow } from "@/lib/reports";
import { addDays } from "@/lib/time/book-time";

// Statement of cash flows, indirect method: net income, then every change
// in a balance sheet account between the day before the period and its
// last day. Because every entry balances, the three sections always add up
// to the change in cash; `difference` is there only to show if they don't.

export type CashFlowSection = "operating" | "investing" | "financing";

export interface CashFlowLine {
  account_id: string;
  account_number: string;
  name: string;
  amount: number;
}

export interface CashFlowStatement {
  netIncome: number;
  operating: CashFlowLine[];
  investing: CashFlowLine[];
  financing: CashFlowLine[];
  cashAccounts: CashFlowLine[];
  cashAtStart: number;
  cashAtEnd: number;
  difference: number;
}

// The chart of accounts has no finer type than asset/liability, so the
// section comes from the name, as the net worth page does it.
// ponytail: name heuristics; add an account subtype column if they misfile real books.
const CASH = /\b(cash|checking|savings|money market|petty cash)\b/i;
const LONG_TERM_ASSET =
  /\b(equipment|furniture|fixtures?|vehicles?|buildings?|land|property|real estate|computers?|machinery|leasehold|invest\w*|brokerage)\b/i;
const FINANCING_LIABILITY = /\b(loans?|mortgages?|notes? payable|line of credit|long[- ]term)\b/i;
const CONTRA = /\b(accumulated|depreciation|amortization)\b/i;

export interface ClassifyHints {
  bankFed: Set<string>;
  fixedAssetAccounts: Set<string>;
}

export function sectionOf(row: Pick<TrialBalanceRow, "account_id" | "account_number" | "name" | "type">, hints: ClassifyHints): CashFlowSection | "cash" | null {
  if (row.type === "revenue" || row.type === "expense") return null;
  if (row.type === "equity") return "financing";
  if (row.type === "liability") return FINANCING_LIABILITY.test(row.name) ? "financing" : "operating";
  if (CONTRA.test(row.name)) return "operating";
  if (hints.fixedAssetAccounts.has(row.account_id) || LONG_TERM_ASSET.test(row.name)) return "investing";
  if (hints.bankFed.has(row.account_id) || CASH.test(row.name) || row.account_number?.startsWith("10")) return "cash";
  return "operating";
}

const round = (n: number) => Math.round(n * 100) / 100;
const netDebit = (r: TrialBalanceRow | undefined) => (r ? Number(r.total_debit) - Number(r.total_credit) : 0);

export function buildCashFlowStatement(
  before: TrialBalanceRow[],
  after: TrialBalanceRow[],
  hints: ClassifyHints,
): CashFlowStatement {
  const prior = new Map(before.map((r) => [r.account_id, r]));
  const statement: CashFlowStatement = {
    netIncome: 0,
    operating: [],
    investing: [],
    financing: [],
    cashAccounts: [],
    cashAtStart: 0,
    cashAtEnd: 0,
    difference: 0,
  };

  for (const row of after) {
    const startDebit = netDebit(prior.get(row.account_id));
    const change = netDebit(row) - startDebit;
    const section = sectionOf(row, hints);
    const line = { account_id: row.account_id, account_number: row.account_number, name: row.name };

    if (section === null) {
      // Revenue is credit-normal: a credit (negative net debit) is income.
      statement.netIncome -= change;
    } else if (section === "cash") {
      statement.cashAtStart += startDebit;
      statement.cashAtEnd += netDebit(row);
      if (round(change) !== 0) statement.cashAccounts.push({ ...line, amount: round(change) });
    } else if (round(change) !== 0) {
      // More of a non-cash asset (a debit) used cash; more owed (a credit) brought it in.
      statement[section].push({ ...line, amount: round(-change) });
    }
  }

  const sum = (lines: CashFlowLine[]) => lines.reduce((s, l) => s + l.amount, 0);
  statement.netIncome = round(statement.netIncome);
  statement.cashAtStart = round(statement.cashAtStart);
  statement.cashAtEnd = round(statement.cashAtEnd);
  const explained = statement.netIncome + sum(statement.operating) + sum(statement.investing) + sum(statement.financing);
  statement.difference = round(statement.cashAtEnd - statement.cashAtStart - explained);
  return statement;
}

export async function fetchCashFlowStatement(orgId: string, start: string, end: string): Promise<CashFlowStatement> {
  const supabase = await createClient();
  const [before, after, fed, fixed] = await Promise.all([
    fetchTrialBalance(orgId, addDays(start, -1)),
    fetchTrialBalance(orgId, end),
    supabase.from("accounts").select("id").eq("organization_id", orgId).eq("has_bank_feed", true),
    supabase.from("fixed_assets").select("asset_account_id").eq("organization_id", orgId),
  ]);
  if (fed.error) throw fed.error;
  if (fixed.error) throw fixed.error;
  return buildCashFlowStatement(before, after, {
    bankFed: new Set(((fed.data ?? []) as { id: string }[]).map((a) => a.id)),
    fixedAssetAccounts: new Set(((fixed.data ?? []) as { asset_account_id: string }[]).map((a) => a.asset_account_id)),
  });
}

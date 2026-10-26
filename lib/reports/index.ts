import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/time/book-time";

export interface TrialBalanceRow {
  account_id: string;
  account_number: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  total_debit: number;
  total_credit: number;
  balance: number;
}

export interface IncomeStatementRow {
  account_id: string;
  account_number: string;
  name: string;
  type: "revenue" | "expense";
  amount: number;
}

export interface BalanceSheetRow {
  account_id: string | null;
  account_number: string | null;
  name: string;
  type: "asset" | "liability" | "equity";
  balance: number;
}

export async function fetchTrialBalance(
  orgId: string,
  asOfDate: string,
): Promise<TrialBalanceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_trial_balance", {
    p_org_id: orgId,
    p_as_of_date: asOfDate,
  });

  if (error) throw error;
  return data ?? [];
}

export async function fetchIncomeStatement(
  orgId: string,
  startDate: string,
  endDate: string,
): Promise<IncomeStatementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_income_statement", {
    p_org_id: orgId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) throw error;
  return data ?? [];
}

export async function fetchBalanceSheet(
  orgId: string,
  asOfDate: string,
): Promise<BalanceSheetRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_balance_sheet", {
    p_org_id: orgId,
    p_as_of_date: asOfDate,
  });

  if (error) throw error;
  return data ?? [];
}

export interface TaxLineReportRow {
  tax_line_id: string | null;
  form: string | null;
  code: string | null;
  label: string;
  sort_order: number;
  property_id: string | null;
  property_name: string | null;
  account_type: "revenue" | "expense";
  amount: number;
}

export async function fetchTaxLineReport(
  orgId: string,
  startDate: string,
  endDate: string,
): Promise<TaxLineReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_tax_line_report", {
    p_org_id: orgId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) throw error;
  return data ?? [];
}

export interface TaxLineAccountRow {
  account_id: string;
  account_number: string;
  name: string;
  type: "revenue" | "expense";
  amount: number;
}

// taxLineId null means "the Unassigned bucket for this type" — type is
// required in that case and ignored otherwise. propertyId picks a Schedule
// E line's property (null: accounts with none).
export async function fetchTaxLineAccounts(
  orgId: string,
  taxLineId: string | null,
  type: "revenue" | "expense",
  startDate: string,
  endDate: string,
  propertyId: string | null = null,
): Promise<TaxLineAccountRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_tax_line_accounts", {
    p_org_id: orgId,
    p_tax_line_id: taxLineId,
    p_type: type,
    p_start_date: startDate,
    p_end_date: endDate,
    p_property_id: propertyId,
  });

  if (error) throw error;
  return data ?? [];
}

export interface AccountLedgerRow {
  entry_id: string;
  entry_date: string;
  memo: string | null;
  description: string | null;
  debit: number;
  credit: number;
}

// startDate null means "from inception" — used when drilling into an
// as-of-date report (Trial Balance / Balance Sheet), which shows a
// cumulative balance rather than a period balance.
export async function fetchAccountLedger(
  orgId: string,
  accountId: string,
  startDate: string | null,
  endDate: string,
): Promise<AccountLedgerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_account_ledger", {
    p_org_id: orgId,
    p_account_id: accountId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error) throw error;
  return data ?? [];
}

export interface GeneralLedgerLine {
  account_id: string;
  entry_id: string;
  entry_date: string;
  memo: string | null;
  description: string | null;
  debit: number;
  credit: number;
}

export interface GeneralLedgerAccount {
  account: Pick<TrialBalanceRow, "account_id" | "account_number" | "name" | "type">;
  opening: number;
  lines: (GeneralLedgerLine & { balance: number })[];
  closing: number;
}

// Each account with activity in the period or a balance going into it:
// the opening balance (the trial balance the day before), every line with a
// running balance, and the closing balance. Balances are signed the way the
// trial balance signs them (debit-normal for assets and expenses).
export function buildGeneralLedger(opening: TrialBalanceRow[], lines: GeneralLedgerLine[]): GeneralLedgerAccount[] {
  const byAccount = new Map<string, GeneralLedgerLine[]>();
  for (const line of lines) {
    byAccount.set(line.account_id, [...(byAccount.get(line.account_id) ?? []), line]);
  }
  return opening
    .filter((row) => byAccount.has(row.account_id) || Number(row.balance) !== 0)
    .map((row) => {
      const sign = row.type === "asset" || row.type === "expense" ? 1 : -1;
      let balance = Number(row.balance);
      const withBalance = (byAccount.get(row.account_id) ?? []).map((line) => {
        balance = Math.round((balance + sign * (Number(line.debit) - Number(line.credit))) * 100) / 100;
        return { ...line, debit: Number(line.debit), credit: Number(line.credit), balance };
      });
      const { account_id, account_number, name, type } = row;
      return { account: { account_id, account_number, name, type }, opening: Number(row.balance), lines: withBalance, closing: balance };
    });
}

export async function fetchGeneralLedger(orgId: string, startDate: string, endDate: string): Promise<GeneralLedgerAccount[]> {
  const supabase = await createClient();
  const [opening, { data, error }] = await Promise.all([
    fetchTrialBalance(orgId, addDays(startDate, -1)),
    supabase.rpc("get_general_ledger", { p_org_id: orgId, p_start_date: startDate, p_end_date: endDate }),
  ]);
  if (error) throw error;
  return buildGeneralLedger(opening, (data ?? []) as GeneralLedgerLine[]);
}

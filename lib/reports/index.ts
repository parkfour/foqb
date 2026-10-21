import { createClient } from "@/lib/supabase/server";

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

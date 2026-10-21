import type { SupabaseClient } from "@supabase/supabase-js";

export interface BudgetCategoryInput {
  accountId: string;
  accountNumber: string;
  accountName: string;
  budgetedAmount: number;
  actualSpent: number;
  notes?: string | null;
}

export type BudgetStatus = "on_track" | "caution" | "over_budget";

export interface BudgetCategoryItem extends BudgetCategoryInput {
  remainingAmount: number;
  percentageUsed: number;
  status: BudgetStatus;
}

export interface MonthlyBudgetReport {
  organizationId: string;
  yearMonth: string;
  totalBudgeted: number;
  totalSpent: number;
  totalRemaining: number;
  overallPercentage: number;
  categories: BudgetCategoryItem[];
}

/**
 * Pure function to compute budget vs actual analytics for categories.
 */
export function calculateBudgetSummary(
  organizationId: string,
  yearMonth: string,
  items: BudgetCategoryInput[],
): MonthlyBudgetReport {
  let totalBudgeted = 0;
  let totalSpent = 0;

  const categories: BudgetCategoryItem[] = items.map((item) => {
    const budgeted = Math.max(0, Number(item.budgetedAmount) || 0);
    const spent = Number(item.actualSpent) || 0;
    const remaining = budgeted - spent;

    let percentageUsed = 0;
    if (budgeted > 0) {
      percentageUsed = Math.round((spent / budgeted) * 1000) / 10;
    } else if (spent > 0) {
      percentageUsed = 100;
    }

    let status: BudgetStatus = "on_track";
    // Compared in cents, so spending against a $0 budget is over, not 100%.
    if (Math.round(spent * 100) > Math.round(budgeted * 100)) {
      status = "over_budget";
    } else if (percentageUsed >= 80) {
      status = "caution";
    }

    totalBudgeted += budgeted;
    totalSpent += spent;

    return {
      ...item,
      budgetedAmount: Math.round(budgeted * 100) / 100,
      actualSpent: Math.round(spent * 100) / 100,
      remainingAmount: Math.round(remaining * 100) / 100,
      percentageUsed,
      status,
    };
  });

  // Sort by account number
  categories.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

  const totalRemaining = Math.round((totalBudgeted - totalSpent) * 100) / 100;
  let overallPercentage = 0;
  if (totalBudgeted > 0) {
    overallPercentage = Math.round((totalSpent / totalBudgeted) * 1000) / 10;
  } else if (totalSpent > 0) {
    overallPercentage = 100;
  }

  return {
    organizationId,
    yearMonth,
    totalBudgeted: Math.round(totalBudgeted * 100) / 100,
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalRemaining,
    overallPercentage,
    categories,
  };
}

/**
 * Fetch monthly budget report from Supabase general ledger and budget tables.
 */
export async function getMonthlyBudgetReport(
  supabase: SupabaseClient,
  orgId: string,
  yearMonth: string,
): Promise<MonthlyBudgetReport> {
  // Validate YYYY-MM format
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`Invalid year_month format: ${yearMonth}. Expected YYYY-MM.`);
  }

  const [yearStr, monthStr] = yearMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const startDate = `${yearMonth}-01`;
  // Day 0 of the next month is the last day of this one.
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  // 1. Fetch active expense accounts
  const { data: accounts, error: accError } = await supabase
    .from("accounts")
    .select("id, account_number, name")
    .eq("organization_id", orgId)
    .eq("type", "expense")
    .eq("is_active", true)
    .order("account_number");

  if (accError) {
    throw new Error(`Failed to fetch accounts: ${accError.message}`);
  }

  // 2. Fetch budget entries for this month
  const { data: budgets, error: bError } = await supabase
    .from("monthly_budgets")
    .select("account_id, budgeted_amount, notes")
    .eq("organization_id", orgId)
    .eq("year_month", yearMonth);

  if (bError) {
    throw new Error(`Failed to fetch budgets: ${bError.message}`);
  }

  const budgetMap = new Map<string, { budgetedAmount: number; notes?: string | null }>();
  for (const b of budgets || []) {
    budgetMap.set(b.account_id, {
      budgetedAmount: Number(b.budgeted_amount) || 0,
      notes: b.notes,
    });
  }

  // 3. What was actually spent, per expense account (debits less credits),
  // totalled in the database by get_income_statement so there's no row limit.
  const { data: statement, error: isError } = await supabase.rpc("get_income_statement", {
    p_org_id: orgId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (isError) {
    throw new Error(`Failed to fetch actual spending: ${isError.message}`);
  }

  const spentMap = new Map<string, number>();
  for (const row of (statement ?? []) as { account_id: string; type: string; amount: number | string }[]) {
    if (row.type === "expense") spentMap.set(row.account_id, Number(row.amount) || 0);
  }

  // 4. Combine inputs
  const inputs: BudgetCategoryInput[] = (accounts || []).map((acc) => {
    const b = budgetMap.get(acc.id);
    const spent = spentMap.get(acc.id) || 0;
    return {
      accountId: acc.id,
      accountNumber: acc.account_number,
      accountName: acc.name,
      budgetedAmount: b?.budgetedAmount || 0,
      actualSpent: spent,
      notes: b?.notes ?? null,
    };
  });

  return calculateBudgetSummary(orgId, yearMonth, inputs);
}

/**
 * Save / upsert a monthly budget item.
 */
export async function upsertMonthlyBudget(
  supabase: SupabaseClient,
  orgId: string,
  accountId: string,
  yearMonth: string,
  budgetedAmount: number,
  notes?: string | null,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`Invalid year_month format: ${yearMonth}. Expected YYYY-MM.`);
  }

  const cleanAmount = Math.max(0, Number(budgetedAmount) || 0);

  const { error } = await supabase.from("monthly_budgets").upsert(
    {
      organization_id: orgId,
      account_id: accountId,
      year_month: yearMonth,
      budgeted_amount: cleanAmount,
      notes: notes ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,account_id,year_month" },
  );

  if (error) {
    throw new Error(`Failed to upsert monthly budget: ${error.message}`);
  }
}

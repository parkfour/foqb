import type { SupabaseClient } from "@supabase/supabase-js";

export interface BudgetCategoryInput {
  accountId: string;
  accountNumber: string;
  accountName: string;
  budgetedAmount: number;
  actualSpent: number;
  notes?: string | null;
  // Rollover accounts: what's left (or overspent, negative) from earlier
  // months, added to this month's budget.
  rollover?: boolean;
  carriedOver?: number;
}

export type BudgetStatus = "on_track" | "caution" | "over_budget";

export interface BudgetCategoryItem extends BudgetCategoryInput {
  rollover: boolean;
  carriedOver: number;
  // This month's budget plus what was carried over.
  available: number;
  remainingAmount: number;
  percentageUsed: number;
  status: BudgetStatus;
}

export interface MonthlyBudgetReport {
  organizationId: string;
  yearMonth: string;
  totalBudgeted: number;
  totalCarriedOver: number;
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
  let totalCarried = 0;
  let totalSpent = 0;

  const categories: BudgetCategoryItem[] = items.map((item) => {
    const budgeted = Math.max(0, Number(item.budgetedAmount) || 0);
    const spent = Number(item.actualSpent) || 0;
    const carried = item.rollover ? Math.round((Number(item.carriedOver) || 0) * 100) / 100 : 0;
    const available = budgeted + carried;
    const remaining = available - spent;

    let percentageUsed = 0;
    if (available > 0) {
      percentageUsed = Math.round((spent / available) * 1000) / 10;
    } else if (spent > 0) {
      percentageUsed = 100;
    }

    let status: BudgetStatus = "on_track";
    // Compared in cents, so spending against a $0 budget is over, not 100%.
    if (Math.round(spent * 100) > Math.round(available * 100)) {
      status = "over_budget";
    } else if (percentageUsed >= 80) {
      status = "caution";
    }

    totalBudgeted += budgeted;
    totalCarried += carried;
    totalSpent += spent;

    return {
      ...item,
      rollover: !!item.rollover,
      carriedOver: carried,
      available: Math.round(available * 100) / 100,
      budgetedAmount: Math.round(budgeted * 100) / 100,
      actualSpent: Math.round(spent * 100) / 100,
      remainingAmount: Math.round(remaining * 100) / 100,
      percentageUsed,
      status,
    };
  });

  // Sort by account number
  categories.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

  const totalAvailable = totalBudgeted + totalCarried;
  const totalRemaining = Math.round((totalAvailable - totalSpent) * 100) / 100;
  let overallPercentage = 0;
  if (totalAvailable > 0) {
    overallPercentage = Math.round((totalSpent / totalAvailable) * 1000) / 10;
  } else if (totalSpent > 0) {
    overallPercentage = 100;
  }

  return {
    organizationId,
    yearMonth,
    totalBudgeted: Math.round(totalBudgeted * 100) / 100,
    totalCarriedOver: Math.round(totalCarried * 100) / 100,
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
    .select("id, account_number, name, budget_rollover")
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

  // 4. Carried over into this month, per rollover account: every earlier
  // month's budget, less everything spent from its first budgeted month
  // to the end of last month.
  const carried = await carriedOverInto(
    supabase,
    orgId,
    yearMonth,
    (accounts ?? []).filter((a) => a.budget_rollover).map((a) => a.id as string),
  );

  // 5. Combine inputs
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
      rollover: !!acc.budget_rollover,
      carriedOver: carried.get(acc.id) ?? 0,
    };
  });

  return calculateBudgetSummary(orgId, yearMonth, inputs);
}

// Budgets before `yearMonth` minus spending since each account's first
// one. Spending is read once per distinct first month.
export function carryover(
  budgets: { account_id: string; year_month: string; budgeted_amount: number | string }[],
  spentSince: (accountId: string, firstMonth: string) => number,
): Map<string, number> {
  const byAccount = new Map<string, { first: string; total: number }>();
  for (const b of budgets) {
    const cur = byAccount.get(b.account_id) ?? { first: b.year_month, total: 0 };
    cur.first = b.year_month < cur.first ? b.year_month : cur.first;
    cur.total += Number(b.budgeted_amount) || 0;
    byAccount.set(b.account_id, cur);
  }
  const out = new Map<string, number>();
  for (const [accountId, { first, total }] of byAccount) {
    out.set(accountId, Math.round((total - spentSince(accountId, first)) * 100) / 100);
  }
  return out;
}

async function carriedOverInto(
  supabase: SupabaseClient,
  orgId: string,
  yearMonth: string,
  accountIds: string[],
): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const { data: earlier, error } = await supabase
    .from("monthly_budgets")
    .select("account_id, year_month, budgeted_amount")
    .eq("organization_id", orgId)
    .in("account_id", accountIds)
    .lt("year_month", yearMonth);
  if (error) throw new Error(`Failed to fetch earlier budgets: ${error.message}`);
  const rows = (earlier ?? []) as { account_id: string; year_month: string; budgeted_amount: number }[];

  const firstMonths = new Set<string>();
  const firstOf = new Map<string, string>();
  for (const r of rows) {
    const f = firstOf.get(r.account_id);
    if (!f || r.year_month < f) firstOf.set(r.account_id, r.year_month);
  }
  for (const f of firstOf.values()) firstMonths.add(f);

  const [y, m] = yearMonth.split("-").map(Number);
  const lastMonthEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  const spent = new Map<string, Map<string, number>>();
  for (const first of firstMonths) {
    const { data, error: isError } = await supabase.rpc("get_income_statement", {
      p_org_id: orgId,
      p_start_date: `${first}-01`,
      p_end_date: lastMonthEnd,
    });
    if (isError) throw new Error(`Failed to fetch earlier spending: ${isError.message}`);
    spent.set(
      first,
      new Map(((data ?? []) as { account_id: string; amount: number | string }[]).map((r) => [r.account_id, Number(r.amount) || 0])),
    );
  }
  return carryover(rows, (accountId, first) => spent.get(first)?.get(accountId) ?? 0);
}

// Zero-based budgeting: income since the first month anything was
// budgeted, less every budget through this month. What's left still needs
// a job; below zero, more was budgeted than came in.
export interface ToAssign {
  since: string | null;
  income: number;
  budgeted: number;
  toAssign: number;
}

export function toAssign(
  since: string | null,
  income: number,
  budgets: { year_month: string; budgeted_amount: number | string }[],
  yearMonth: string,
): ToAssign {
  const budgeted = Math.round(budgets.filter((b) => b.year_month <= yearMonth).reduce((s, b) => s + (Number(b.budgeted_amount) || 0), 0) * 100) / 100;
  return { since, income: Math.round(income * 100) / 100, budgeted, toAssign: Math.round((income - budgeted) * 100) / 100 };
}

export async function getToAssign(supabase: SupabaseClient, orgId: string, yearMonth: string): Promise<ToAssign> {
  const { data: budgets, error } = await supabase
    .from("monthly_budgets")
    .select("year_month, budgeted_amount")
    .eq("organization_id", orgId)
    .lte("year_month", yearMonth);
  if (error) throw new Error(`Failed to fetch budgets: ${error.message}`);
  const rows = (budgets ?? []) as { year_month: string; budgeted_amount: number }[];
  if (rows.length === 0) return toAssign(null, 0, [], yearMonth);

  const since = rows.reduce((first, b) => (b.year_month < first ? b.year_month : first), rows[0].year_month);
  const [y, m] = yearMonth.split("-").map(Number);
  const { data: statement, error: isError } = await supabase.rpc("get_income_statement", {
    p_org_id: orgId,
    p_start_date: `${since}-01`,
    p_end_date: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  });
  if (isError) throw new Error(`Failed to fetch income: ${isError.message}`);
  const income = ((statement ?? []) as { type: string; amount: number | string }[])
    .filter((r) => r.type === "revenue")
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return toAssign(since, income, rows, yearMonth);
}

// Envelopes: every expense category carries what's left (or overspent)
// into the next month.
export async function setAllBudgetRollover(supabase: SupabaseClient, orgId: string, rollover: boolean): Promise<void> {
  const { error } = await supabase
    .from("accounts")
    .update({ budget_rollover: rollover })
    .eq("organization_id", orgId)
    .eq("type", "expense");
  if (error) throw new Error(`Failed to change rollover: ${error.message}`);
}

export async function setBudgetRollover(
  supabase: SupabaseClient,
  orgId: string,
  accountId: string,
  rollover: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("accounts")
    .update({ budget_rollover: rollover })
    .eq("id", accountId)
    .eq("organization_id", orgId)
    .eq("type", "expense");
  if (error) throw new Error(`Failed to change rollover: ${error.message}`);
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

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, getCurrentUserRole, canWrite } from "@/lib/org/current";
import { setBudgetRollover, upsertMonthlyBudget } from "@/lib/budget/engine";

export async function updateBudgetCategoryAction(
  accountId: string,
  yearMonth: string,
  budgetedAmount: number,
  notes?: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const orgId = await getCurrentOrgId();
    if (!orgId) {
      return { success: false, error: "No active organization" };
    }

    const role = await getCurrentUserRole(orgId);
    if (!canWrite(role)) {
      return { success: false, error: "Read-only access" };
    }

    const supabase = await createClient();
    await upsertMonthlyBudget(
      supabase,
      orgId,
      accountId,
      yearMonth,
      budgetedAmount,
      notes,
    );

    revalidatePath("/budget");
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update budget";
    return { success: false, error: message };
  }
}

export async function copyPreviousMonthAction(
  targetYearMonth: string,
): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    const orgId = await getCurrentOrgId();
    if (!orgId) {
      return { success: false, error: "No active organization" };
    }

    const role = await getCurrentUserRole(orgId);
    if (!canWrite(role)) {
      return { success: false, error: "Read-only access" };
    }

    const supabase = await createClient();

    const [yearStr, monthStr] = targetYearMonth.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYearMonth = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

    // Fetch previous month budgets
    const { data: prevBudgets, error: fetchErr } = await supabase
      .from("monthly_budgets")
      .select("account_id, budgeted_amount, notes")
      .eq("organization_id", orgId)
      .eq("year_month", prevYearMonth);

    if (fetchErr) {
      return { success: false, error: fetchErr.message };
    }

    if (!prevBudgets || prevBudgets.length === 0) {
      return { success: false, error: `No budget entries found in previous month (${prevYearMonth}).` };
    }

    const upserts = prevBudgets.map((b) => ({
      organization_id: orgId,
      account_id: b.account_id,
      year_month: targetYearMonth,
      budgeted_amount: b.budgeted_amount,
      notes: b.notes,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertErr } = await supabase
      .from("monthly_budgets")
      .upsert(upserts, { onConflict: "organization_id,account_id,year_month" });

    if (upsertErr) {
      return { success: false, error: upsertErr.message };
    }

    revalidatePath("/budget");
    return { success: true, count: upserts.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to copy budget";
    return { success: false, error: message };
  }
}

export async function setBudgetRolloverAction(
  accountId: string,
  rollover: boolean,
): Promise<{ success: boolean; error?: string }> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { success: false, error: "No active organization" };
  if (!canWrite(await getCurrentUserRole(orgId))) return { success: false, error: "Read-only access" };
  try {
    await setBudgetRollover(await createClient(), orgId, accountId, rollover);
    revalidatePath("/budget");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Couldn't change rollover" };
  }
}

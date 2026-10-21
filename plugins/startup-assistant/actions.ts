// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bookToday } from "@/lib/org/book-clock";
import { canWrite, getCurrentOrgId, getCurrentUserRole, getWorkspaceType } from "@/lib/org/current";
import { averageSpending, budgetTimeframe, monthsBetween } from "./budget";

export interface AccountStart {
  accountId: string;
  name: string;
  startsOn: string;
  earlyEntries: number;
  earlyRows: number;
}

export interface Startup {
  accounts: AccountStart[];
  // A household's suggested months for a starting budget; null for a
  // business book, or before a whole month is in.
  budget: { from: string; to: string } | null;
}

type Result<T> = { success: true; value: T } | { success: false; error: string };

async function writableOrg(): Promise<string | null> {
  const orgId = await getCurrentOrgId();
  return orgId && canWrite(await getCurrentUserRole(orgId)) ? orgId : null;
}

// Each account's start and what reaches back before it; null once the book
// is done with the assistant. The first look turns it on for the book.
export async function getStartup(): Promise<Startup | null> {
  const orgId = await writableOrg();
  if (!orgId) return null;
  const supabase = await createClient();
  const { data: state } = await supabase
    .from("startup_assistant")
    .select("finished_at")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (state?.finished_at) return null;
  if (!state) await supabase.from("startup_assistant").insert({ organization_id: orgId });

  const { data } = await supabase.rpc("startup_overview", { p_org: orgId });
  const accounts = (
    (data ?? []) as { account_id: string; account_name: string; starts_on: string; early_entries: number; early_rows: number }[]
  ).map((r) => ({
    accountId: r.account_id,
    name: r.account_name,
    startsOn: r.starts_on,
    earlyEntries: r.early_entries,
    earlyRows: r.early_rows,
  }));
  const household = (await getWorkspaceType(orgId)) === "household";
  return {
    accounts,
    budget: household ? budgetTimeframe(accounts.map((a) => a.startsOn), await bookToday(orgId)) : null,
  };
}

// A household's starting budget: each expense account's average monthly
// spending from `from` to `to` ("YYYY-MM"), budgeted in each of those
// months. A month already budgeted for an account is left as it is.
export async function startBudget(from: string, to: string): Promise<Result<{ accounts: number; months: number }>> {
  const orgId = await writableOrg();
  if (!orgId) return { success: false, error: "You can't change this book" };
  if ((await getWorkspaceType(orgId)) !== "household") return { success: false, error: "Budgets are for household books" };
  let months: string[];
  try {
    months = monthsBetween(from, to);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  const supabase = await createClient();
  const [year, month] = to.split("-").map(Number);
  const { data, error } = await supabase.rpc("get_income_statement", {
    p_org_id: orgId,
    p_start_date: `${from}-01`,
    p_end_date: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), // the last day of `to`
  });
  if (error) return { success: false, error: error.message };

  const averages = averageSpending(data ?? [], months.length);
  const rows = averages.flatMap(({ accountId, monthly }) =>
    months.map((yearMonth) => ({ organization_id: orgId, account_id: accountId, year_month: yearMonth, budgeted_amount: monthly })),
  );
  if (rows.length > 0) {
    const { error: saveError } = await supabase
      .from("monthly_budgets")
      .upsert(rows, { onConflict: "organization_id,account_id,year_month", ignoreDuplicates: true });
    if (saveError) return { success: false, error: saveError.message };
  }
  revalidatePath("/budget");
  return { success: true, value: { accounts: averages.length, months: months.length } };
}

export async function cleanUpStartup(): Promise<Result<{ moved: number; kept: number; ignored: number }>> {
  const orgId = await writableOrg();
  if (!orgId) return { success: false, error: "You can't change this book" };
  const { data, error } = await (await createClient()).rpc("startup_clean_up", { p_org: orgId });
  if (error) return { success: false, error: error.message };
  revalidatePath("/register");
  revalidatePath("/reconcile");
  return { success: true, value: data as { moved: number; kept: number; ignored: number } };
}

// Turns the assistant off for the book: its guard stops and the panel goes.
export async function finishStartup(): Promise<Result<null>> {
  const orgId = await writableOrg();
  if (!orgId) return { success: false, error: "You can't change this book" };
  const { error } = await (await createClient())
    .from("startup_assistant")
    .update({ finished_at: new Date().toISOString() })
    .eq("organization_id", orgId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/reconcile");
  return { success: true, value: null };
}

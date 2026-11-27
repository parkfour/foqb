import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/current-user";
import { bookToday } from "@/lib/org/book-clock";

// A gentle reminder on the Bank Balances table and the chart of accounts:
// an account whose last reconciled statement is older than the book's
// organizations.reconcile_nag_days is tinted, with a hover note. Only
// accounts reconciled at least once are nagged.
export const DEFAULT_RECONCILE_NAG_DAYS = 40;
export const MAX_RECONCILE_NAG_DAYS = 366;

// Per-user opt-out, kept in the user's Supabase Auth metadata (it's about
// the person, not the book, and needs no schema or backup changes).
export const RECONCILE_NAG_OFF_KEY = "reconcile_nag_off";

export interface StaleReconciliation {
  days: number;
  statementDate: string;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Latest completed statement per account, kept only when it's past the nag age.
export function staleReconciliations(
  rows: { account_id: string; statement_date: string }[],
  today: string,
  nagDays: number,
): Map<string, StaleReconciliation> {
  const latest = new Map<string, string>();
  for (const r of rows) {
    const seen = latest.get(r.account_id);
    if (!seen || r.statement_date > seen) latest.set(r.account_id, r.statement_date);
  }
  const stale = new Map<string, StaleReconciliation>();
  for (const [accountId, statementDate] of latest) {
    const days = daysBetween(statementDate, today);
    if (days > nagDays) stale.set(accountId, { days, statementDate });
  }
  return stale;
}

export function reconcileNagText({ days, statementDate }: StaleReconciliation): string {
  return `${days} days since the last reconciled statement (${statementDate})`;
}

export async function isReconcileNagOff(): Promise<boolean> {
  const user = await getAuthUser();
  return user?.user_metadata?.[RECONCILE_NAG_OFF_KEY] === true;
}

export async function fetchStaleReconciliations(orgId: string): Promise<Map<string, StaleReconciliation>> {
  if (await isReconcileNagOff()) return new Map();
  const supabase = await createClient();
  const [{ data }, { data: org }, today] = await Promise.all([
    supabase
      .from("bank_reconciliations")
      .select("account_id, statement_date")
      .eq("organization_id", orgId)
      .eq("status", "completed"),
    supabase.from("organizations").select("reconcile_nag_days").eq("id", orgId).maybeSingle(),
    bookToday(orgId),
  ]);
  const nagDays = (org as { reconcile_nag_days: number } | null)?.reconcile_nag_days ?? DEFAULT_RECONCILE_NAG_DAYS;
  return staleReconciliations((data as { account_id: string; statement_date: string }[] | null) ?? [], today, nagDays);
}

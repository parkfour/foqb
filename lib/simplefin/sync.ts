import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { processBankTransactions } from "@/lib/plaid/processor";
import { bookPendingTransfers } from "@/lib/bank/transfers";
import { bookOpeningBalances } from "@/lib/bank/opening-balance";
import { addDays, localDate } from "@/lib/time/book-time";
import { instanceTimezone } from "@/lib/org/book-clock";
import {
  SimplefinAuthError,
  externalAccountId,
  getAccountSet,
  toFeedTransactions,
  type SimplefinAccount,
} from "./client";

// SimpleFIN Bridge keeps 90 days, and asks for at most 45 a request, so
// the first sync takes two. Each later sync asks again from a few days
// before the last one, for transactions that post late; ones already in
// the feed are skipped by their id.
const FIRST_SYNC_DAYS = 90;
const WINDOW_DAYS = 45;
const OVERLAP_DAYS = 7;
// Bridge allows about 24 requests a day per connection.
export const SIMPLEFIN_SYNC_INTERVAL_SECONDS = 4 * 60 * 60;

export async function syncSimplefinEnrollment(enrollmentId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, organization_id, access_token, cursor")
    .eq("id", enrollmentId)
    .eq("provider", "simplefin")
    .maybeSingle();
  if (!enrollment) return;

  const orgId = enrollment.organization_id as string;
  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  const timeZone = (org as { timezone: string | null } | null)?.timezone ?? instanceTimezone();
  const today = localDate(timeZone);
  const lastSync = enrollment.cursor as string | null;
  const startDate = addDays(lastSync ?? today, lastSync ? -OVERLAP_DAYS : -FIRST_SYNC_DAYS);

  // Each window's accounts; the last window has the current balances.
  const windows: SimplefinAccount[][] = [];
  try {
    const accessUrl = decryptToken(enrollment.access_token as string);
    for (let from = startDate; from < today; from = addDays(from, WINDOW_DAYS)) {
      const to = addDays(from, WINDOW_DAYS);
      const set = await getAccountSet(accessUrl, from, false, to < today ? to : null);
      if (set.errors.length) console.warn(`SimpleFIN reported for enrollment ${enrollmentId}: ${set.errors.join("; ")}`);
      windows.push(set.accounts);
    }
  } catch (error) {
    if (error instanceof SimplefinAuthError) {
      await supabase
        .from("enrollments")
        .update({ status: "error", disconnect_reason: `${error.message}. Connect it again with a new setup token.` })
        .eq("id", enrollmentId);
    }
    throw error;
  }

  const { data: ledger } = await supabase
    .from("accounts")
    .select("id, type, external_account_id")
    .eq("organization_id", orgId)
    .in("external_account_id", [...new Set(windows.flat().map(externalAccountId))]);
  const byExternal = new Map(((ledger ?? []) as { id: string; type: string; external_account_id: string }[]).map((a) => [a.external_account_id, a]));

  const at = new Date().toISOString();
  for (const account of windows.flat()) {
    const target = byExternal.get(externalAccountId(account));
    if (target) await processBankTransactions(orgId, target.id, toFeedTransactions(account, timeZone));
  }
  for (const account of windows.at(-1) ?? []) {
    const target = byExternal.get(externalAccountId(account));
    if (!target) continue;
    // Stored the way Plaid gives balances: what's owed is positive.
    const balance = Number(account.balance);
    const available = account["available-balance"] === undefined ? null : Number(account["available-balance"]);
    const owed = target.type === "liability";
    await supabase
      .from("accounts")
      .update({
        bank_balance: owed ? Math.abs(balance) : balance,
        bank_available: available === null ? null : owed ? Math.abs(available) : available,
        bank_balance_at: at,
      })
      .eq("id", target.id);
  }

  await supabase
    .from("enrollments")
    .update({ cursor: today, last_synced_at: at, status: "active", disconnect_reason: null })
    .eq("id", enrollmentId);

  // Best-effort, as for Plaid: the feed is saved either way.
  try {
    await bookPendingTransfers(supabase, orgId);
    await bookOpeningBalances(supabase, orgId);
  } catch (error) {
    console.error(`Failed to book transfers or opening balances for SimpleFIN enrollment ${enrollmentId}`, error);
  }
}

// The piggyback job: every active SimpleFIN connection, one at a time.
export async function syncAllSimplefin(): Promise<void> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("enrollments").select("id").eq("provider", "simplefin").eq("status", "active");
  for (const { id } of (data ?? []) as { id: string }[]) {
    try {
      await syncSimplefinEnrollment(id);
    } catch (error) {
      console.error(`SimpleFIN sync failed for enrollment ${id}`, error);
    }
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllRows } from "@/lib/supabase/read-all";
import { submitSplitTransaction } from "@/lib/transactions/split";

// Money moving between two of your own linked accounts shows up twice, once
// in each account's feed. These pair an uncategorized row with the
// uncategorized row on the other side, so it can be booked once as a
// transfer. The database applies the same rule when either side is booked
// (match_transfer_counterparts in 20260101000057_bank_feed_improvements.sql).

// Days apart the two sides can be dated: a transfer can take a couple of
// business days to arrive. Keep in step with the migration's "<= 5".
export const TRANSFER_WINDOW_DAYS = 5;

export interface TransferCandidate {
  id: string;
  account_id: string | null;
  date: string;
  amount: number;
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

// For each row, the best other side: another account, the opposite amount,
// within the window, nearest date first. Each row is used at most once, so
// two identical transfers pair off one to one.
export function pairTransfers<T extends TransferCandidate>(rows: T[]): Map<string, T> {
  const pairs = new Map<string, T>();
  const options: { a: T; b: T; gap: number }[] = [];

  for (const a of rows) {
    if (!a.account_id || a.amount >= 0) continue; // walk from the money-out side
    for (const b of rows) {
      if (!b.account_id || b.account_id === a.account_id) continue;
      if (Math.round(b.amount * 100) !== Math.round(-a.amount * 100)) continue;
      const gap = daysApart(a.date, b.date);
      if (gap <= TRANSFER_WINDOW_DAYS) options.push({ a, b, gap });
    }
  }

  options.sort((x, y) => x.gap - y.gap || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id));
  for (const { a, b } of options) {
    if (pairs.has(a.id) || pairs.has(b.id)) continue;
    pairs.set(a.id, b);
    pairs.set(b.id, a);
  }
  return pairs;
}

// Books every transfer waiting in the feed: each pair's money-out side is
// categorized to the other account, and the database matches the money-in
// side to the same entry (match_transfer_counterparts). Returns the ids of
// both rows of each pair booked. A pair that fails (say, a locked period)
// stays in the feed.
export async function bookPendingTransfers(supabase: SupabaseClient, organizationId: string): Promise<string[]> {
  const rows = await readAllRows<TransferCandidate>((from, to) =>
    supabase
      .from("bank_transactions")
      .select("id, account_id, date, amount")
      .eq("organization_id", organizationId)
      .eq("status", "unreconciled")
      .order("id")
      .range(from, to),
  );
  const pairs = pairTransfers(rows.map((r) => ({ ...r, amount: Number(r.amount) })));

  const booked: string[] = [];
  for (const [id, other] of pairs) {
    if (other.amount <= 0) continue; // once per pair, from the money-out side
    const result = await submitSplitTransaction(supabase, id, [{ account_id: other.account_id!, amount: other.amount }]);
    if (result.success) booked.push(id, other.id);
    else console.error(`Failed to book transfer ${id}: ${result.error}`);
  }
  return booked;
}

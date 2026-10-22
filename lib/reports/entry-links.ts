import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllRows } from "@/lib/supabase/read-all";

interface FedRow {
  id: string;
  account_id: string | null;
  journal_entry_id: string;
}

// Where a line of an account's ledger opens: the register at the bank
// transaction it was booked from (on this account's own feed when it has
// one, as for a transfer), or else the journal entry itself.
export async function entryHrefs(
  supabase: SupabaseClient,
  orgId: string,
  accountId: string,
): Promise<(entryId: string) => string> {
  const rows = await readAllRows<FedRow>((from, to) =>
    supabase
      .from("bank_transactions")
      .select("id, account_id, journal_entry_id, journal_entries!inner(journal_lines!inner(account_id))")
      .eq("organization_id", orgId)
      .eq("journal_entries.journal_lines.account_id", accountId)
      .order("id")
      .range(from, to),
  );

  const byEntry = new Map<string, FedRow>();
  for (const row of rows) {
    const seen = byEntry.get(row.journal_entry_id);
    if (!seen || row.account_id === accountId) byEntry.set(row.journal_entry_id, row);
  }

  return (entryId) => {
    const fed = byEntry.get(entryId);
    return fed?.account_id ? registerHref(fed.account_id, fed.id) : `/journal/${entryId}`;
  };
}

export function registerHref(accountId: string, bankTransactionId: string): string {
  return `/register?account=${accountId}&tx=${bankTransactionId}`;
}

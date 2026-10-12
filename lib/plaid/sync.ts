import { createAdminClient } from "@/lib/supabase/admin";
import { syncTransactions } from "@/lib/plaid/client";
import { processBankTransactions, processRemovedTransactions } from "@/lib/plaid/processor";
import { decryptToken } from "@/lib/crypto/token-encryption";

// Pulls every page of new/modified/removed transactions for one Plaid Item
// since its saved cursor and books them. The cursor is only saved after
// every page succeeds, so a failure anywhere means the next sync resumes
// from the same point (already-recorded transactions dedupe).
// Shared by the webhook and the enrollment's initial backfill.
export async function syncItem(itemId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, organization_id, access_token, cursor")
    .eq("external_item_id", itemId)
    .maybeSingle();

  if (!enrollment) return;

  const accessToken = decryptToken(enrollment.access_token as string);
  const accounts = new Map<string, string>(); // Plaid account_id -> ledger account id

  let cursor = enrollment.cursor as string | null;
  let hasMore = true;

  while (hasMore) {
    const result = await syncTransactions(accessToken, cursor);

    if (result.removed.length > 0) {
      await processRemovedTransactions(result.removed);
    }

    const byAccount = new Map<string, typeof result.added>();
    for (const tx of [...result.added, ...result.modified]) {
      const list = byAccount.get(tx.account_id) ?? [];
      list.push(tx);
      byAccount.set(tx.account_id, list);
    }

    for (const [plaidAccountId, transactions] of byAccount) {
      let ledgerAccountId = accounts.get(plaidAccountId);

      if (!ledgerAccountId) {
        const { data: ledgerAccount } = await supabase
          .from("accounts")
          .select("id")
          .eq("organization_id", enrollment.organization_id)
          .eq("external_account_id", plaidAccountId)
          .maybeSingle();

        if (!ledgerAccount) {
          console.error(`No ledger account found for Plaid account ${plaidAccountId}`);
          continue;
        }

        ledgerAccountId = ledgerAccount.id as string;
        accounts.set(plaidAccountId, ledgerAccountId);
      }

      await processBankTransactions(enrollment.organization_id, ledgerAccountId, transactions);
    }

    cursor = result.nextCursor;
    hasMore = result.hasMore;
  }

  await supabase.from("enrollments").update({ cursor }).eq("id", enrollment.id);
}

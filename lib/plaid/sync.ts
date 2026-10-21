import { createAdminClient } from "@/lib/supabase/admin";
import { getAccounts, syncTransactions } from "@/lib/plaid/client";
import { processBankTransactions, processRemovedTransactions } from "@/lib/plaid/processor";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { bookPendingTransfers } from "@/lib/bank/transfers";
import { bookOpeningBalances } from "@/lib/bank/opening-balance";

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

  await supabase
    .from("enrollments")
    .update({ cursor, last_synced_at: new Date().toISOString() })
    .eq("id", enrollment.id);

  // Best-effort: a balance that's a sync behind is still useful, and a
  // failure here shouldn't undo the transactions just saved.
  try {
    await saveBankBalances(supabase, enrollment.organization_id as string, await getAccounts(accessToken));
  } catch (error) {
    console.error(`Failed to update bank balances for Plaid Item ${itemId}`, error);
  }

  // Also best-effort, for the same reason: the feed is saved either way.
  try {
    await bookPendingTransfers(supabase, enrollment.organization_id as string);
    await bookOpeningBalances(supabase, enrollment.organization_id as string);
  } catch (error) {
    console.error(`Failed to book transfers or opening balances for Plaid Item ${itemId}`, error);
  }
}

export async function saveBankBalances(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  accounts: Awaited<ReturnType<typeof getAccounts>>,
): Promise<void> {
  const at = new Date().toISOString();
  for (const account of accounts) {
    if (account.balances.current === null) continue;
    await supabase
      .from("accounts")
      .update({ bank_balance: account.balances.current, bank_available: account.balances.available, bank_balance_at: at })
      .eq("organization_id", organizationId)
      .eq("external_account_id", account.id);
  }
}

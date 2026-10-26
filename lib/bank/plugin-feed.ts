// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SupabaseClient } from "@supabase/supabase-js";
import { processBankTransactions } from "@/lib/plaid/processor";
import { addLedgerAccounts } from "@/lib/plaid/ledger-accounts";
import { bankLinkingBlockedReason } from "@/lib/plaid/bank-linking";
import { bookPendingTransfers } from "@/lib/bank/transfers";
import { bookOpeningBalances } from "@/lib/bank/opening-balance";
import type { BankFeedAccount } from "@/lib/plugins/types";

// Ids are prefixed with the plugin's, so two feeds can't collide with each
// other or with Plaid and SimpleFIN.
export const feedId = (pluginId: string, id: string) => `${pluginId}:${id}`;

// Books what a plugin's bank feed returned for one book, the way SimpleFIN's
// is booked (lib/simplefin/sync.ts). Returns how many accounts it booked.
export async function ingestBankFeed(
  admin: SupabaseClient,
  pluginId: string,
  organizationId: string,
  accounts: BankFeedAccount[],
): Promise<number> {
  if (accounts.length === 0) return 0;
  const blocked = await bankLinkingBlockedReason(admin, organizationId);
  if (blocked) throw new Error(blocked);

  const externalIds = accounts.map((a) => feedId(pluginId, a.id));
  const ledger = async () => {
    const { data, error } = await admin
      .from("accounts")
      .select("id, type, external_account_id")
      .eq("organization_id", organizationId)
      .in("external_account_id", externalIds);
    if (error) throw error;
    return new Map(((data ?? []) as { id: string; type: string; external_account_id: string }[]).map((a) => [a.external_account_id, a]));
  };

  let byExternal = await ledger();
  const fresh = accounts.filter((a) => !byExternal.has(feedId(pluginId, a.id)));
  if (fresh.length) {
    const error = await addLedgerAccounts(
      admin,
      organizationId,
      fresh.map((a) => ({ id: feedId(pluginId, a.id), name: a.name, mask: a.mask ?? null, type: a.kind === "liability" ? "credit" : "depository" })),
    );
    if (error) throw new Error(error);
    byExternal = await ledger();
  }

  const at = new Date().toISOString();
  for (const account of accounts) {
    const target = byExternal.get(feedId(pluginId, account.id));
    if (!target) continue;
    // The shared processor takes Plaid's sign (positive is money out).
    await processBankTransactions(
      organizationId,
      target.id,
      account.transactions.map((t) => ({ id: feedId(pluginId, t.id), account_id: feedId(pluginId, account.id), date: t.date, name: t.name, amount: -t.amount })),
    );
    if (account.balance != null) {
      await admin
        .from("accounts")
        .update({ bank_balance: account.balance, bank_available: account.available ?? null, bank_balance_at: at })
        .eq("id", target.id);
    }
  }

  // Best-effort, as for the built-in feeds.
  try {
    await bookPendingTransfers(admin, organizationId);
    await bookOpeningBalances(admin, organizationId);
  } catch (error) {
    console.error(`Failed to book transfers or opening balances for ${pluginId}'s feed in ${organizationId}`, error);
  }
  return accounts.length;
}

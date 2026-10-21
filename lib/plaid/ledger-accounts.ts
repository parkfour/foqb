import type { SupabaseClient } from "@supabase/supabase-js";
import { nextAccountNumbers } from "@/lib/org/account-numbering";
import type { PlaidAccount } from "@/lib/plaid/client";

// Plaid's own account `type` (depository/credit/loan/investment/other) tells
// us which side of the balance sheet an account belongs on — a credit card
// or loan is money owed, not money held. Only "credit" and "loan" are debt;
// everything else (depository, investment, other) is money the org has.
export function mapPlaidAccountType(plaidType: string): "asset" | "liability" {
  return plaidType === "credit" || plaidType === "loan" ? "liability" : "asset";
}

// A ledger account for each Plaid account. Returns the error, if any.
export async function addLedgerAccounts(
  supabase: SupabaseClient,
  organizationId: string,
  plaidAccounts: Pick<PlaidAccount, "id" | "name" | "mask" | "type">[],
): Promise<string | null> {
  if (plaidAccounts.length === 0) return null;
  const types = plaidAccounts.map((account) => mapPlaidAccountType(account.type));
  const accountNumbers = await nextAccountNumbers(supabase, organizationId, types);

  const accountRows = plaidAccounts.map((account, i) => ({
    organization_id: organizationId,
    account_number: accountNumbers[i],
    // account.name is already human-readable (Plaid's own or the bank's
    // nickname for it) — the mask disambiguates two accounts that would
    // otherwise share the same name (e.g. two checking accounts).
    name: account.mask ? `${account.name} ••${account.mask}` : account.name,
    type: types[i],
    description: "Linked via Plaid",
    external_account_id: account.id,
  }));

  const { error } = await supabase.from("accounts").insert(accountRows);
  return error?.message ?? null;
}

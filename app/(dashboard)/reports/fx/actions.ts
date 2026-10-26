"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/org/current";
import { revaluationLines } from "@/lib/fx/revalue";

interface ForeignBalance {
  account_id: string;
  type: "asset" | "liability";
  currency: string;
  foreign_balance: number;
  book_balance: number;
}

// Posts the revaluation for one account as of a date, from the balances
// the database gives for that date (not what the page showed).
export async function revalueAccount(_prev: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const orgId = await getCurrentOrgId();
  const accountId = formData.get("accountId") as string;
  const asOf = formData.get("asOf") as string;
  const rate = Number(formData.get("rate"));
  const gainLossAccountId = formData.get("gainLossAccountId") as string;
  if (!orgId || !accountId || !asOf) return { error: "No account" };
  if (!(rate > 0)) return { error: "Enter the rate" };
  if (!gainLossAccountId) return { error: "Choose the exchange gain or loss account" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_foreign_balances", { p_org_id: orgId, p_as_of_date: asOf });
  if (error) return { error: error.message };
  const account = ((data ?? []) as ForeignBalance[]).find((a) => a.account_id === accountId);
  if (!account) return { error: "That account isn't in another currency" };

  const lines = revaluationLines(
    { ...account, foreign_balance: Number(account.foreign_balance), book_balance: Number(account.book_balance) },
    rate,
    gainLossAccountId,
  );
  if (!lines) return { error: "Already carried at that rate" };

  const { error: postError } = await supabase.rpc("post_journal_entry", {
    p_org_id: orgId,
    p_entry_date: asOf,
    p_memo: `Revalue ${account.currency} at ${rate}`,
    p_lines: lines,
  });
  if (postError) return { error: postError.message };
  revalidatePath("/reports");
  return { error: null };
}

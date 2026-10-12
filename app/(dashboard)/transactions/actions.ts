"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function ignoreBankTransaction(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  // Only an unreconciled transaction can be ignored — a matched one is
  // backed by a posted entry, and "ignored" would hide that link.
  await supabase
    .from("bank_transactions")
    .update({ status: "ignored" })
    .eq("id", id)
    .eq("status", "unreconciled");

  revalidatePath("/transactions");
}

export async function categorizeBankTransaction(formData: FormData): Promise<void> {
  const bankTransactionId = formData.get("bankTransactionId") as string;
  const targetAccountId = formData.get("targetAccountId") as string;
  if (!bankTransactionId || !targetAccountId) return;

  const supabase = await createClient();

  const { data: tx } = await supabase
    .from("bank_transactions")
    .select("id, organization_id, account_id, date, name, amount, status")
    .eq("id", bankTransactionId)
    .maybeSingle();

  if (!tx || tx.status !== "unreconciled" || !tx.account_id) return;

  const amount = Number(tx.amount);
  const absAmount = Math.abs(amount);
  const lines =
    amount < 0
      ? [
          { account_id: targetAccountId, debit: absAmount, credit: 0 },
          { account_id: tx.account_id, debit: 0, credit: absAmount },
        ]
      : [
          { account_id: tx.account_id, debit: absAmount, credit: 0 },
          { account_id: targetAccountId, debit: 0, credit: absAmount },
        ];

  // One transaction: the entry, its lines, posting, and claiming the bank
  // transaction (only if still unreconciled) all succeed or none do.
  await supabase.rpc("post_journal_entry", {
    p_org_id: tx.organization_id,
    p_entry_date: tx.date,
    p_memo: tx.name,
    p_lines: lines,
    p_bank_transaction_id: tx.id,
  });

  revalidatePath("/transactions");
}

// Applies the bank's changed amount/date to a matched transaction whose
// entry nothing else depends on: voids that entry and returns the
// transaction to unreconciled so it can be categorized again. The database
// refuses when the entry is tied to a payment, a reconciliation or a locked
// period (reopen_blocker) — the UI only offers this when it isn't.
export async function reopenBankTransaction(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_bank_transaction", { p_bank_transaction_id: id });
  if (error) console.error(`Failed to re-open bank transaction ${id}`, error);

  revalidatePath("/transactions");
}

// For a bank change the user has handled themselves (or decided to keep the
// booked values for): clears the flag, changes nothing else.
export async function dismissBankChange(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("bank_transactions").update({ bank_change: null }).eq("id", id);

  revalidatePath("/transactions");
}

export async function voidJournalEntry(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  // Only a posted entry can be voided — the .eq("status", "posted") guard
  // makes this a no-op against a draft/already-void entry regardless of
  // what the UI shows.
  await supabase.from("journal_entries").update({ status: "void" }).eq("id", id).eq("status", "posted");

  revalidatePath("/transactions");
}

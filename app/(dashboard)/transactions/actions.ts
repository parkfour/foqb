"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { submitSplitTransaction } from "@/lib/transactions/split";
import { bookPendingTransfers } from "@/lib/bank/transfers";
import { readAllRows } from "@/lib/supabase/read-all";
import { getCurrentOrgId } from "@/lib/org/current";

export async function ignoreBankTransaction(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;
  await ignoreTransactionAction(id);
}

// Set aside without booking (a duplicate, say); Re-open brings it back.
export async function ignoreTransactionAction(
  bankTransactionId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  // Only an unreconciled transaction can be ignored — a matched one is
  // backed by a posted entry, and "ignored" would hide that link.
  const { data, error } = await supabase
    .from("bank_transactions")
    .update({ status: "ignored" })
    .eq("id", bankTransactionId)
    .eq("status", "unreconciled")
    .select("id");
  if (error) return { success: false, error: error.message };
  if (!data?.length) return { success: false, error: "Only an uncategorized transaction can be ignored" };

  revalidatePath("/transactions");
  revalidatePath("/register");
  return { success: true };
}

// A duplicate, once ignored, can be deleted outright. Only an ignored row:
// it has no entry, and ignoring it first is the confirmation.
export async function deleteBankTransaction(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("bank_transactions").delete().eq("id", id).eq("status", "ignored");
  if (error) console.error(`Failed to delete bank transaction ${id}`, error);

  revalidatePath("/transactions");
  revalidatePath("/register");
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

// Returns a categorized (or ignored) transaction to unreconciled so it can
// be categorized again, voiding its entry and applying any bank change held
// for review. The database refuses when the entry is tied to a payment, a
// reconciliation or a locked period (reopen_blocker); the UI only offers
// this when it isn't.
export async function reopenBankTransaction(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_bank_transaction", { p_bank_transaction_id: id });
  if (error) console.error(`Failed to re-open bank transaction ${id}`, error);

  revalidatePath("/transactions");
  revalidatePath("/register");
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
  revalidatePath("/journal");
}

export async function splitBankTransactionAction(
  bankTransactionId: string,
  splits: { account_id: string; amount: number; memo?: string | null }[],
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const result = await submitSplitTransaction(supabase, bankTransactionId, splits);
  if (result.success) {
    revalidatePath("/transactions");
    revalidatePath("/register");
  }
  return result;
}

// The register's cleared checkmark, on the bank transaction and on the lines
// of the entry it was booked to. RLS limits it to writers.
export async function setRegisterClearedAction(
  bankTransactionId: string,
  cleared: boolean,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: tx, error } = await supabase
    .from("bank_transactions")
    .update({ cleared })
    .eq("id", bankTransactionId)
    .select("journal_entry_id")
    .maybeSingle();
  if (error || !tx) return { success: false, error: error?.message ?? "Transaction not found" };

  if (tx.journal_entry_id) {
    const { error: linesError } = await supabase
      .from("journal_lines")
      .update({ cleared })
      .eq("journal_entry_id", tx.journal_entry_id);
    if (linesError) return { success: false, error: linesError.message };
  }

  revalidatePath("/register");
  return { success: true };
}

// Books a transfer between two linked accounts from either side: categorized
// to the other account, after which the database matches the other side's
// row to the same entry (match_transfer_counterparts).
export async function bookTransferAction(
  bankTransactionId: string,
  otherAccountId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: tx } = await supabase
    .from("bank_transactions")
    .select("amount")
    .eq("id", bankTransactionId)
    .maybeSingle();
  if (!tx) return { success: false, error: "Transaction not found" };

  const result = await submitSplitTransaction(supabase, bankTransactionId, [
    { account_id: otherAccountId, amount: Math.abs(Number(tx.amount)) },
  ]);
  if (result.success) {
    revalidatePath("/transactions");
    revalidatePath("/register");
  }
  return result;
}

// Back to uncategorized so it can be booked again: voids its entry (both
// sides, for a transfer). Refused for anything tied to a payment, a
// reconciliation or a locked period (reopen_blocker).
export async function reopenTransactionAction(
  bankTransactionId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_bank_transaction", { p_bank_transaction_id: bankTransactionId });
  if (error) return { success: false, error: error.message };
  revalidatePath("/transactions");
  revalidatePath("/register");
  return { success: true };
}

// A categorized transaction's new category, reconciled or not: its entry is
// re-booked with only the category changed (recategorize_bank_transaction),
// so the bank side and any reconciliation stay as they were.
export async function recategorizeTransactionAction(
  bankTransactionId: string,
  accountId: string,
): Promise<{ success: boolean; error?: string; journalEntryId?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recategorize_bank_transaction", {
    p_bank_transaction_id: bankTransactionId,
    p_account_id: accountId,
  });
  if (error) return { success: false, error: error.message };
  revalidatePath("/transactions");
  revalidatePath("/register");
  revalidatePath("/journal");
  return { success: true, journalEntryId: data as string };
}

export async function recategorizeBankTransaction(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const accountId = formData.get("accountId") as string;
  if (!id || !accountId) return;
  const result = await recategorizeTransactionAction(id, accountId);
  if (!result.success) console.error(`Failed to change the category of ${id}: ${result.error}`);
}

export async function bookTransfer(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const otherAccountId = formData.get("otherAccountId") as string;
  if (!id || !otherAccountId) return;
  const result = await bookTransferAction(id, otherAccountId);
  if (!result.success) console.error(`Failed to book transfer for ${id}: ${result.error}`);
}

// Every transfer waiting in the current book's feed, both sides at once.
export async function bookAllTransfersAction(): Promise<{ success: boolean; bookedIds?: string[]; error?: string }> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { success: false, error: "No book selected" };
  const supabase = await createClient();
  try {
    const bookedIds = await bookPendingTransfers(supabase, orgId);
    revalidatePath("/transactions");
    revalidatePath("/register");
    return { success: true, bookedIds };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Couldn't book the transfers" };
  }
}

// "Always categorize this payee like this": a rule for future imports
// (match_bank_transaction, "contains"), then the same category for the
// uncategorized rows already in the feed that it matches. Returns their ids.
export async function savePayeeRuleAction(
  bankTransactionId: string,
  matchText: string,
  targetAccountId: string,
): Promise<{ success: boolean; categorizedIds?: string[]; error?: string }> {
  const text = matchText.trim();
  if (!text || text.length > 255) return { success: false, error: "Enter the payee text to match (up to 255 characters)" };

  const supabase = await createClient();
  const { data: tx } = await supabase
    .from("bank_transactions")
    .select("organization_id")
    .eq("id", bankTransactionId)
    .maybeSingle();
  if (!tx) return { success: false, error: "Transaction not found" };

  const { error: ruleError } = await supabase.from("categorization_rules").insert({
    organization_id: tx.organization_id,
    target_account_id: targetAccountId,
    rule_name: `Payee: ${text}`.slice(0, 100),
    match_type: "contains",
    match_text: text,
  });
  if (ruleError) return { success: false, error: ruleError.message };

  // The same test the rule applies: a case-insensitive "contains".
  const rows = await readAllRows<{ id: string; amount: number }>((from, to) =>
    supabase
      .from("bank_transactions")
      .select("id, amount")
      .eq("organization_id", tx.organization_id)
      .eq("status", "unreconciled")
      .ilike("name", `%${text}%`)
      .order("id")
      .range(from, to),
  );
  const categorizedIds: string[] = [];
  for (const row of rows) {
    const result = await submitSplitTransaction(supabase, row.id, [
      { account_id: targetAccountId, amount: Math.abs(Number(row.amount)) },
    ]);
    if (result.success) categorizedIds.push(row.id);
  }

  revalidatePath("/transactions");
  revalidatePath("/register");
  revalidatePath("/rules");
  return { success: true, categorizedIds };
}

// How many of the book's bank transactions are waiting to be categorized.
export async function countUncategorized(): Promise<number> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return 0;
  const { count } = await (await createClient())
    .from("bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "unreconciled");
  return count ?? 0;
}

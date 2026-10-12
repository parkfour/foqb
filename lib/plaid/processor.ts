import { createAdminClient } from "@/lib/supabase/admin";
import type { PlaidTransaction } from "@/lib/plaid/client";

type AdminClient = ReturnType<typeof createAdminClient>;

// Journal lines for a bank-feed transaction in this app's sign convention
// (negative = money out): an expense debits the target and credits the
// bank account, a deposit the reverse.
function bankEntryLines(bankAccountId: string, targetAccountId: string, amount: number) {
  const absAmount = Math.abs(amount);
  return amount < 0
    ? [
        { account_id: targetAccountId, debit: absAmount, credit: 0 },
        { account_id: bankAccountId, debit: 0, credit: absAmount },
      ]
    : [
        { account_id: bankAccountId, debit: absAmount, credit: 0 },
        { account_id: targetAccountId, debit: 0, credit: absAmount },
      ];
}

// Plaid's sync can report a previously-synced transaction as removed (e.g. a
// pending transaction that never posted). Deleting the journal entry first
// isn't allowed — bank_transactions.journal_entry_id would still reference
// it — so the bank_transactions row goes first, then the entry.
async function removeTransaction(supabase: AdminClient, externalTransactionId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("bank_transactions")
    .select("id, journal_entry_id")
    .eq("external_transaction_id", externalTransactionId)
    .maybeSingle();

  if (!existing) return;

  await supabase.from("bank_transactions").delete().eq("id", existing.id);

  if (existing.journal_entry_id) {
    await supabase.from("journal_entries").delete().eq("id", existing.journal_entry_id);
  }
}

// Brings an already-recorded transaction up to date with what the bank now
// reports. Unmatched rows just take the new values. A matched row's entry
// may be tied to a payment or reconciliation, so a changed amount/date is
// held in bank_change for the user to review on the Bank Feed (see
// 20260101000038_bank_change_review.sql) instead of being applied.
async function applyBankEdit(supabase: AdminClient, tx: PlaidTransaction, amount: number): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from("bank_transactions")
    .select("id, status, amount, date")
    .eq("external_transaction_id", tx.id)
    .maybeSingle();

  if (readError) {
    throw new Error(`Failed to read bank transaction ${tx.id}: ${readError.message}`);
  }
  if (!existing) return;

  let update: Record<string, unknown>;
  if (existing.status !== "matched") {
    update = { date: tx.date, name: tx.name, amount };
  } else {
    const changed =
      Math.round(Number(existing.amount) * 100) !== Math.round(amount * 100) || existing.date !== tx.date;
    if (changed) {
      console.warn(
        `Plaid changed matched transaction ${tx.id}: ${existing.amount} on ${existing.date} -> ${amount} on ${tx.date}; held for review`,
      );
    }
    // A later edit back to the booked values clears the flag again.
    update = { name: tx.name, bank_change: changed ? { amount, date: tx.date } : null };
  }

  const { error: updateError } = await supabase.from("bank_transactions").update(update).eq("id", existing.id);
  if (updateError) {
    throw new Error(`Failed to update bank transaction ${tx.id}: ${updateError.message}`);
  }
}

export async function processRemovedTransactions(
  removed: { id: string }[],
): Promise<void> {
  const supabase = createAdminClient();
  for (const tx of removed) {
    await removeTransaction(supabase, tx.id);
  }
}

export async function processBankTransactions(
  organizationId: string,
  bankAccountId: string,
  transactions: PlaidTransaction[],
): Promise<void> {
  const supabase = createAdminClient();

  for (const tx of transactions) {
    // Normalize to this app's internal convention (negative = expense,
    // positive = deposit) — Plaid's own sign is the opposite.
    const amount = -tx.amount;

    // Recorded first, as unreconciled: if categorizing it below fails for
    // any reason, it stays visible for manual review instead of vanishing.
    // The unique external_transaction_id makes a re-delivered transaction
    // a no-op (empty result) rather than a duplicate.
    const { data: inserted, error: insertError } = await supabase
      .from("bank_transactions")
      .upsert(
        {
          organization_id: organizationId,
          account_id: bankAccountId,
          external_transaction_id: tx.id,
          external_account_id: tx.account_id,
          date: tx.date,
          name: tx.name,
          amount,
          status: "unreconciled",
          journal_entry_id: null,
        },
        { onConflict: "external_transaction_id", ignoreDuplicates: true },
      )
      .select("id");

    // Thrown, not skipped: the webhook then doesn't advance its sync cursor,
    // so the next sync re-delivers this transaction instead of losing it.
    if (insertError) {
      throw new Error(`Failed to record bank transaction ${tx.id}: ${insertError.message}`);
    }

    const bankTransactionId = (inserted as { id: string }[] | null)?.[0]?.id;

    if (!bankTransactionId) {
      // Already recorded: a redelivery or one of Plaid's "modified" transactions.
      await applyBankEdit(supabase, tx, amount);
      continue;
    }

    const { data: matchedAccountId, error: matchError } = await supabase.rpc(
      "match_bank_transaction",
      {
        p_org_id: organizationId,
        p_description: tx.name,
        p_amount: amount,
      },
    );

    if (matchError) {
      console.error(`match_bank_transaction failed for ${tx.id}`, matchError);
      continue;
    }
    if (!matchedAccountId) continue;

    const { error: postError } = await supabase.rpc("post_journal_entry", {
      p_org_id: organizationId,
      p_entry_date: tx.date,
      p_memo: tx.name,
      p_lines: bankEntryLines(bankAccountId, matchedAccountId as string, amount),
      p_bank_transaction_id: bankTransactionId,
    });

    if (postError) {
      console.error(`Failed to post matched transaction ${tx.id}; left unreconciled`, postError);
    }
  }
}

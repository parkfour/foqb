import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlaidTransaction } from "@/lib/plaid/client";
import { enabledCategorizers } from "@/lib/plugins/server-loader";

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

// A bank connected again gives every account and transaction new Plaid ids.
// When its ledger account was linked to an existing one (enroll's
// linkedAccounts), the history it re-sends is already here under the old
// connection's ids: the same account, date and amount. That row takes the
// new ids, so later edits and removals from Plaid find it, instead of the
// transaction being booked twice. Each old row is claimed at most once,
// so two same-day, same-amount transactions still pair off one to one.
async function adoptRelinkedRow(
  supabase: AdminClient,
  bankAccountId: string,
  tx: PlaidTransaction,
  amount: number,
): Promise<boolean> {
  const { data: known } = await supabase
    .from("bank_transactions")
    .select("id")
    .eq("external_transaction_id", tx.id)
    .maybeSingle();
  if (known) return false;

  const { data: old } = await supabase
    .from("bank_transactions")
    .select("id")
    .eq("account_id", bankAccountId)
    .neq("external_account_id", tx.account_id)
    .eq("date", tx.date)
    .eq("amount", amount)
    .order("id")
    .limit(1)
    .maybeSingle();
  if (!old) return false;

  const { error } = await supabase
    .from("bank_transactions")
    .update({ external_transaction_id: tx.id, external_account_id: tx.account_id })
    .eq("id", old.id);
  if (error) throw new Error(`Failed to adopt bank transaction ${tx.id}: ${error.message}`);
  return true;
}

// Books a new feed row: a plugin's categorizer first, then the account its
// organization's rules pick (match_bank_transaction), if any. Left
// uncategorized when nothing matches or posting fails. Also used by the
// statement import.
export async function categorizeByRules(
  supabase: SupabaseClient,
  organizationId: string,
  bankAccountId: string,
  row: { id: string; date: string; name: string; amount: number },
): Promise<void> {
  for (const categorize of enabledCategorizers()) {
    try {
      if (await categorize(supabase, organizationId, bankAccountId, row)) return;
    } catch (err) {
      console.error(`A plugin's categorizer failed on ${row.id}; left to the rules`, err);
    }
  }

  const { data: matchedAccountId, error: matchError } = await supabase.rpc("match_bank_transaction", {
    p_org_id: organizationId,
    p_description: row.name,
    p_amount: row.amount,
  });

  if (matchError) {
    console.error(`match_bank_transaction failed for ${row.id}`, matchError);
    return;
  }
  if (!matchedAccountId) return;

  const { error: postError } = await supabase.rpc("post_journal_entry", {
    p_org_id: organizationId,
    p_entry_date: row.date,
    p_memo: row.name,
    p_lines: bankEntryLines(bankAccountId, matchedAccountId as string, row.amount),
    p_bank_transaction_id: row.id,
  });

  if (postError) {
    console.error(`Failed to post matched transaction ${row.id}; left unreconciled`, postError);
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

    if (await adoptRelinkedRow(supabase, bankAccountId, tx, amount)) {
      await applyBankEdit(supabase, tx, amount);
      continue;
    }

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
      .select("id, status");

    // Thrown, not skipped: the webhook then doesn't advance its sync cursor,
    // so the next sync re-delivers this transaction instead of losing it.
    if (insertError) {
      throw new Error(`Failed to record bank transaction ${tx.id}: ${insertError.message}`);
    }

    const row = (inserted as { id: string; status: string }[] | null)?.[0];

    if (!row) {
      // Already recorded: a redelivery or one of Plaid's "modified" transactions.
      await applyBankEdit(supabase, tx, amount);
      continue;
    }
    // The other side of a transfer that's already booked: the database
    // matched it to that entry on insert (match_booked_transfer).
    if (row.status === "matched") continue;
    const bankTransactionId = row.id;

    await categorizeByRules(supabase, organizationId, bankAccountId, {
      id: bankTransactionId,
      date: tx.date,
      name: tx.name,
      amount,
    });
  }
}

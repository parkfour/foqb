// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SupabaseClient } from "@supabase/supabase-js";
import { submitSplitTransaction } from "@/lib/transactions/split";
import { readAllRows } from "@/lib/supabase/read-all";
import { dayBefore, equityAccountId, OPENING_BALANCE_MEMO, openingEntryLines } from "@/lib/bank/opening-balance";
import { scheduledBalance, splitPayment } from "./schedule";

export interface MortgageNote {
  id: string;
  name: string;
  borrower_name: string;
  original_principal: number;
  annual_rate: number;
  term_months: number;
  origination_date: string;
  first_payment_date: string;
  payment_amount: number;
  escrow_amount: number;
  match_text: string;
  note_account_id: string;
  interest_account_id: string;
  escrow_account_id: string | null;
}

const BEFORE_OPENING = "It's from before the note's opening balance";

const NOTE_COLUMNS =
  "id, name, borrower_name, original_principal, annual_rate, term_months, origination_date, first_payment_date, payment_amount, escrow_amount, match_text, note_account_id, interest_account_id, escrow_account_id";

function toNote(row: Record<string, unknown>): MortgageNote {
  return {
    ...(row as unknown as MortgageNote),
    original_principal: Number(row.original_principal),
    annual_rate: Number(row.annual_rate),
    payment_amount: Number(row.payment_amount),
    escrow_amount: Number(row.escrow_amount),
  };
}

// An asset account's balance from posted entries dated on or before `date`
// (null when it has none: the books don't have the note yet).
async function balanceOrNull(supabase: SupabaseClient, accountId: string, date: string): Promise<number | null> {
  const lines = await readAllRows<{ debit: number; credit: number }>((from, to) =>
    supabase
      .from("journal_lines")
      .select("debit, credit, journal_entries!inner(entry_date, status)")
      .eq("account_id", accountId)
      .eq("journal_entries.status", "posted")
      .lte("journal_entries.entry_date", date)
      .order("id")
      .range(from, to),
  );
  if (lines.length === 0) return null;
  return Math.round(lines.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0) * 100) / 100;
}

async function balanceThrough(supabase: SupabaseClient, accountId: string, date: string): Promise<number> {
  return (await balanceOrNull(supabase, accountId, date)) ?? 0;
}

const likeText = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function noteForPayment(notes: MortgageNote[], description: string, amount: number): MortgageNote | null {
  if (amount <= 0) return null;
  const text = description.toLowerCase();
  return notes.find((n) => text.includes(n.match_text.toLowerCase())) ?? null;
}

// Books a borrower's payment, split into interest, escrow and principal on
// what the note's account shows was owed the day before.
export async function bookNotePayment(
  supabase: SupabaseClient,
  note: MortgageNote,
  row: { id: string; date: string; name: string; amount: number },
): Promise<{ success: boolean; error?: string }> {
  // A payment from before the books took the note up is already in its
  // opening balance (and an earlier year's 1098); it's left to the rules.
  const balance = await balanceOrNull(supabase, note.note_account_id, dayBefore(row.date));
  if (balance === null) return { success: false, error: BEFORE_OPENING };
  const split = splitPayment(row.amount, balance, note.annual_rate, note.escrow_account_id ? note.escrow_amount : 0);
  const memo = `${note.name}: payment`;
  const lines = [
    { account_id: note.interest_account_id, amount: split.interest, memo: `${note.name}: interest` },
    { account_id: note.escrow_account_id ?? "", amount: split.escrow, memo: `${note.name}: escrow` },
    { account_id: note.note_account_id, amount: split.principal, memo: `${note.name}: principal` },
  ].filter((l) => l.account_id && l.amount > 0);
  if (lines.length === 0) return { success: false, error: `Nothing to book for ${memo}` };
  return submitSplitTransaction(supabase, row.id, lines);
}

// The bank feed's first look: a deposit naming a borrower is their payment.
export async function categorizeNotePayment(
  supabase: SupabaseClient,
  organizationId: string,
  _bankAccountId: string,
  row: { id: string; date: string; name: string; amount: number },
): Promise<boolean> {
  if (row.amount <= 0) return false;
  const { data } = await supabase.from("mortgage_notes").select(NOTE_COLUMNS).eq("organization_id", organizationId);
  const note = noteForPayment((data ?? []).map(toNote), row.name, row.amount);
  if (!note) return false;
  const result = await bookNotePayment(supabase, note, row);
  if (!result.success && result.error !== BEFORE_OPENING) console.error(`Couldn't book ${row.id} as a payment on ${note.name}: ${result.error}`);
  return result.success;
}

// Books the payments already waiting in the feed, oldest first so each
// one's interest is figured on the balance the one before left.
export async function bookWaitingPayments(supabase: SupabaseClient, organizationId: string, noteId: string): Promise<number> {
  const { data } = await supabase.from("mortgage_notes").select(NOTE_COLUMNS).eq("id", noteId).maybeSingle();
  if (!data) return 0;
  const note = toNote(data);
  const rows = await readAllRows<{ id: string; date: string; name: string; amount: number }>((from, to) =>
    supabase
      .from("bank_transactions")
      .select("id, date, name, amount")
      .eq("organization_id", organizationId)
      .eq("status", "unreconciled")
      .gt("amount", 0)
      .ilike("name", likeText(note.match_text))
      .order("date")
      .order("id")
      .range(from, to),
  );
  let booked = 0;
  for (const row of rows) {
    if ((await bookNotePayment(supabase, note, { ...row, amount: Number(row.amount) })).success) booked++;
  }
  return booked;
}

// What the note's opening entry says: the day the books took it up and
// what was owed then.
export async function noteOpening(
  supabase: SupabaseClient,
  noteAccountId: string,
): Promise<{ id: string; date: string; balance: number } | null> {
  const { data } = await supabase
    .from("journal_lines")
    .select("debit, credit, journal_entries!inner(id, entry_date, status, memo)")
    .eq("account_id", noteAccountId)
    .eq("journal_entries.status", "posted")
    .eq("journal_entries.memo", OPENING_BALANCE_MEMO)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const entry = data.journal_entries as unknown as { id: string; entry_date: string };
  return { id: entry.id, date: entry.entry_date, balance: Number(data.debit) - Number(data.credit) };
}

// Books what was owed on `date` as the note's opening balance, voiding the
// one it had.
export async function setNoteOpening(
  supabase: SupabaseClient,
  organizationId: string,
  noteAccountId: string,
  date: string,
  owed: number,
): Promise<string | null> {
  const current = await noteOpening(supabase, noteAccountId);
  if (current?.date === date && Math.round(current.balance * 100) === Math.round(owed * 100)) return null;
  if (current) {
    const { error } = await supabase.from("journal_entries").update({ status: "void" }).eq("id", current.id).eq("status", "posted");
    if (error) return error.message;
  }
  if (owed === 0) return null;
  const equityId = await equityAccountId(supabase, organizationId);
  if (!equityId) return "The book needs an equity account for the opening balance";
  const { error } = await supabase.rpc("post_journal_entry", {
    p_org_id: organizationId,
    p_entry_date: date,
    p_memo: OPENING_BALANCE_MEMO,
    p_lines: openingEntryLines("asset", owed, noteAccountId, equityId),
  });
  return error?.message ?? null;
}

// Puts the borrower's booked payments back in the feed so they can be split
// again (escrow paid out stays as it is). Ones a reconciliation or closed
// period holds stay; returns how many.
export async function reopenNotePayments(supabase: SupabaseClient, note: MortgageNote): Promise<number> {
  const accounts = [note.note_account_id, note.interest_account_id];
  const lines = await readAllRows<{ journal_entry_id: string }>((from, to) =>
    supabase
      .from("journal_lines")
      .select("journal_entry_id, journal_entries!inner(status)")
      .in("account_id", accounts)
      .eq("journal_entries.status", "posted")
      .order("id")
      .range(from, to),
  );
  const entryIds = [...new Set(lines.map((l) => l.journal_entry_id))];
  let kept = 0;
  // ponytail: one .in() for the entries; chunk it if a note ever has thousands.
  const { data: rows } = entryIds.length
    ? await supabase
        .from("bank_transactions")
        .select("id")
        .in("journal_entry_id", entryIds)
        .eq("status", "matched")
        .gt("amount", 0)
        .ilike("name", likeText(note.match_text))
    : { data: [] };
  for (const row of rows ?? []) {
    const { error } = await supabase.rpc("reopen_bank_transaction", { p_bank_transaction_id: row.id });
    if (error) kept++;
  }
  return kept;
}

export interface Form1098 {
  year: number;
  interestReceived: number; // box 1
  principalOutstanding: number; // box 2, on January 1 (or when made, if made that year)
  originationDate: string; // box 3
  principalReceived: number;
  escrowReceived: number;
  escrowPaidOut: number; // taxes and insurance paid from escrow: box 10, if you report it
}

async function activityIn(supabase: SupabaseClient, accountId: string, year: number) {
  const lines = await readAllRows<{ debit: number; credit: number }>((from, to) =>
    supabase
      .from("journal_lines")
      .select("debit, credit, journal_entries!inner(entry_date, status)")
      .eq("account_id", accountId)
      .eq("journal_entries.status", "posted")
      .gte("journal_entries.entry_date", `${year}-01-01`)
      .lte("journal_entries.entry_date", `${year}-12-31`)
      .order("id")
      .range(from, to),
  );
  const sum = (pick: (l: { debit: number; credit: number }) => number) =>
    Math.round(lines.reduce((s, l) => s + pick(l), 0) * 100) / 100;
  return { debits: sum((l) => Number(l.debit)), credits: sum((l) => Number(l.credit)) };
}

export async function form1098(supabase: SupabaseClient, note: MortgageNote, year: number): Promise<Form1098> {
  const [interest, principal, escrow] = await Promise.all([
    activityIn(supabase, note.interest_account_id, year),
    activityIn(supabase, note.note_account_id, year),
    note.escrow_account_id ? activityIn(supabase, note.escrow_account_id, year) : { debits: 0, credits: 0 },
  ]);
  const madeThisYear = note.origination_date >= `${year}-01-01`;
  const booked = await balanceThrough(supabase, note.note_account_id, `${year - 1}-12-31`);
  // The books may start after January 1; the schedule says what was owed then.
  const outstanding = madeThisYear
    ? note.original_principal
    : booked > 0
      ? booked
      : scheduledBalance(
          {
            originalPrincipal: note.original_principal,
            annualRate: note.annual_rate,
            paymentAmount: note.payment_amount,
            firstPaymentDate: note.first_payment_date,
          },
          `${year - 1}-12-31`,
        );
  return {
    year,
    interestReceived: Math.round((interest.credits - interest.debits) * 100) / 100,
    principalOutstanding: outstanding,
    originationDate: note.origination_date,
    // Credits only: the note's opening balance is a debit, maybe this year.
    principalReceived: principal.credits,
    escrowReceived: escrow.credits,
    escrowPaidOut: escrow.debits,
  };
}

export { NOTE_COLUMNS, toNote };

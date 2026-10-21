// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentUserRole } from "@/lib/org/current";
import { decryptToken, encryptToken } from "@/lib/crypto/token-encryption";
import { nextAccountNumbers } from "@/lib/org/account-numbering";
import {
  bookWaitingPayments,
  form1098,
  NOTE_COLUMNS,
  noteOpening,
  reopenNotePayments,
  setNoteOpening,
  toNote,
  type Form1098,
} from "./notes";
import { scheduledBalance } from "./schedule";

export interface NoteSummary {
  id: string;
  name: string;
  borrowerName: string;
  matchText: string;
  annualRate: number;
  paymentAmount: number;
  escrowAmount: number;
  balance: number;
  borrowerTinLast4: string | null;
}

export interface NoteInput {
  name: string;
  borrowerName: string;
  borrowerAddress: string;
  borrowerTin: string;
  lenderName: string;
  lenderAddress: string;
  lenderTin: string;
  propertyAddress: string;
  originationDate: string;
  originalPrincipal: number;
  annualRate: number;
  termMonths: number;
  firstPaymentDate: string;
  paymentAmount: number;
  escrowAmount: number;
  matchText: string;
  // What was owed when the books take the note up; blank: the schedule's figure.
  balanceAsOf: string;
  balance: number | null;
}

export interface Form1098Report extends Form1098 {
  note: string;
  borrower: { name: string; address: string | null; tin: string | null };
  lender: { name: string | null; address: string | null; tin: string | null };
  propertyAddress: string | null;
}

type Result = { success: true; booked?: number; kept?: number } | { success: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIN = /^\d{3}-?\d{2}-?\d{4}$|^\d{2}-?\d{7}$/;

// Owners and accountants: these hold borrowers' taxpayer ids.
async function allowed(organizationId: string): Promise<boolean> {
  return canWrite(await getCurrentUserRole(organizationId));
}

const clean = (s: string) => s.trim();
const optional = (s: string) => s.trim() || null;

function invalid(input: NoteInput): string | null {
  if (!clean(input.name) || input.name.length > 100) return "Give the note a name (up to 100 characters)";
  if (!clean(input.borrowerName)) return "Enter the borrower's name";
  if (clean(input.matchText).length < 3) return "Enter at least 3 characters of the borrower's name as the bank shows it";
  for (const d of [input.originationDate, input.firstPaymentDate, input.balanceAsOf]) {
    if (!ISO_DATE.test(d)) return "Enter the dates";
  }
  if (!(input.originalPrincipal > 0) || !(input.paymentAmount > 0)) return "Enter the principal and the monthly payment";
  if (!(input.annualRate >= 0 && input.annualRate < 100)) return "Enter the interest rate as a percentage";
  if (!Number.isInteger(input.termMonths) || input.termMonths <= 0) return "Enter the term in months";
  if (!(input.escrowAmount >= 0)) return "Escrow can't be negative";
  for (const tin of [input.borrowerTin, input.lenderTin]) {
    if (clean(tin) && !TIN.test(clean(tin))) return "A taxpayer id is 9 digits (123-45-6789 or 12-3456789)";
  }
  return null;
}

const encryptTin = (tin: string) => (clean(tin) ? encryptToken(clean(tin)) : null);

function revealTin(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    return decryptToken(encrypted);
  } catch {
    return null;
  }
}

// The note's terms as stored (taxpayer ids go separately: they're encrypted).
function noteFields(input: NoteInput) {
  return {
    name: clean(input.name),
    borrower_name: clean(input.borrowerName),
    borrower_address: optional(input.borrowerAddress),
    lender_name: optional(input.lenderName),
    lender_address: optional(input.lenderAddress),
    property_address: optional(input.propertyAddress),
    origination_date: input.originationDate,
    original_principal: input.originalPrincipal,
    annual_rate: input.annualRate,
    term_months: input.termMonths,
    first_payment_date: input.firstPaymentDate,
    payment_amount: input.paymentAmount,
    escrow_amount: input.escrowAmount,
    match_text: clean(input.matchText),
  };
}

function owedOn(input: NoteInput): number {
  return (
    input.balance ??
    scheduledBalance(
      {
        originalPrincipal: input.originalPrincipal,
        annualRate: input.annualRate,
        paymentAmount: input.paymentAmount,
        firstPaymentDate: input.firstPaymentDate,
      },
      input.balanceAsOf,
    )
  );
}

const accountNames = (name: string) => ({
  asset: `Note receivable: ${name}`,
  revenue: `Mortgage interest: ${name}`,
  liability: `Escrow held: ${name}`,
});

export async function getNotes(organizationId: string): Promise<NoteSummary[] | null> {
  if (!(await allowed(organizationId))) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("mortgage_notes")
    .select(`${NOTE_COLUMNS}, borrower_tin_encrypted`)
    .eq("organization_id", organizationId)
    .order("name");
  const notes = data ?? [];
  const balances = await Promise.all(
    notes.map(async (n) => {
      const { data: lines } = await supabase
        .from("journal_lines")
        .select("debit, credit, journal_entries!inner(status)")
        .eq("account_id", n.note_account_id)
        .eq("journal_entries.status", "posted");
      return (lines ?? []).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    }),
  );
  return notes.map((n, i) => ({
    id: n.id,
    name: n.name,
    borrowerName: n.borrower_name,
    matchText: n.match_text,
    annualRate: Number(n.annual_rate),
    paymentAmount: Number(n.payment_amount),
    escrowAmount: Number(n.escrow_amount),
    balance: Math.round(balances[i] * 100) / 100,
    borrowerTinLast4: revealTin(n.borrower_tin_encrypted)?.slice(-4) ?? null,
  }));
}

// Adds the note with an account of its own for the balance owed, the
// interest it earns and (with escrow) the escrow held; books what's owed
// when the books take it up, and the borrower's payments already waiting.
export async function createNote(organizationId: string, input: NoteInput): Promise<Result> {
  if (!(await allowed(organizationId))) return { success: false, error: "You can't change this book" };
  const problem = invalid(input);
  if (problem) return { success: false, error: problem };

  const supabase = await createClient();
  const name = clean(input.name);
  const names = accountNames(name);
  const kinds: ("asset" | "revenue" | "liability")[] = ["asset", "revenue", ...(input.escrowAmount > 0 ? ["liability" as const] : [])];
  const numbers = await nextAccountNumbers(supabase, organizationId, kinds);
  const { data: accounts, error: accountError } = await supabase
    .from("accounts")
    .insert(kinds.map((type, i) => ({ organization_id: organizationId, account_number: numbers[i], name: names[type], type })))
    .select("id, type");
  if (accountError || !accounts) return { success: false, error: accountError?.message ?? "Couldn't add the accounts" };
  const accountOf = (type: string) => accounts.find((a) => a.type === type)?.id ?? null;

  const { data: note, error } = await supabase
    .from("mortgage_notes")
    .insert({
      organization_id: organizationId,
      ...noteFields(input),
      borrower_tin_encrypted: encryptTin(input.borrowerTin),
      lender_tin_encrypted: encryptTin(input.lenderTin),
      note_account_id: accountOf("asset"),
      interest_account_id: accountOf("revenue"),
      escrow_account_id: accountOf("liability"),
    })
    .select("id")
    .single();
  if (error || !note) return { success: false, error: error?.message ?? "Couldn't add the note" };

  const openingError = await setNoteOpening(supabase, organizationId, accountOf("asset")!, input.balanceAsOf, owedOn(input));
  if (openingError) return { success: false, error: openingError };
  const booked = await bookWaitingPayments(supabase, organizationId, note.id);
  revalidatePath("/properties");
  revalidatePath("/register");
  return { success: true, booked };
}

// The note as the form shows it for editing. Taxpayer ids come back as
// their last 4 only; left blank, the stored ones stay.
export async function getNoteForEdit(
  organizationId: string,
  noteId: string,
): Promise<{ values: Record<string, string>; borrowerTinLast4: string | null; lenderTinLast4: string | null } | null> {
  if (!(await allowed(organizationId))) return null;
  const supabase = await createClient();
  const { data: n } = await supabase
    .from("mortgage_notes")
    .select(
      `${NOTE_COLUMNS}, borrower_address, borrower_tin_encrypted, lender_name, lender_address, lender_tin_encrypted, property_address`,
    )
    .eq("id", noteId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!n) return null;
  const opening = await noteOpening(supabase, n.note_account_id);
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    values: {
      name: n.name,
      borrowerName: n.borrower_name,
      matchText: n.match_text,
      borrowerAddress: text(n.borrower_address),
      propertyAddress: text(n.property_address),
      lenderName: text(n.lender_name),
      lenderAddress: text(n.lender_address),
      originalPrincipal: text(n.original_principal),
      annualRate: text(n.annual_rate),
      termMonths: text(n.term_months),
      originationDate: n.origination_date,
      firstPaymentDate: n.first_payment_date,
      paymentAmount: text(n.payment_amount),
      escrowAmount: text(n.escrow_amount),
      balanceAsOf: opening?.date ?? "",
      balance: opening ? String(opening.balance) : "",
    },
    borrowerTinLast4: revealTin(n.borrower_tin_encrypted)?.slice(-4) ?? null,
    lenderTinLast4: revealTin(n.lender_tin_encrypted)?.slice(-4) ?? null,
  };
}

// Saves new terms, books the new opening balance, and splits the booked
// payments again on it (ones a reconciliation holds keep their split).
export async function updateNote(organizationId: string, noteId: string, input: NoteInput): Promise<Result> {
  if (!(await allowed(organizationId))) return { success: false, error: "You can't change this book" };
  const problem = invalid(input);
  if (problem) return { success: false, error: problem };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("mortgage_notes")
    .select(NOTE_COLUMNS)
    .eq("id", noteId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!existing) return { success: false, error: "That note isn't in this book" };
  const before = toNote(existing);
  const names = accountNames(clean(input.name));

  let escrowAccountId = before.escrow_account_id;
  if (!escrowAccountId && input.escrowAmount > 0) {
    const [number] = await nextAccountNumbers(supabase, organizationId, ["liability"]);
    const { data: account, error } = await supabase
      .from("accounts")
      .insert({ organization_id: organizationId, account_number: number, name: names.liability, type: "liability" })
      .select("id")
      .single();
    if (error || !account) return { success: false, error: error?.message ?? "Couldn't add the escrow account" };
    escrowAccountId = account.id;
  }

  const { error } = await supabase
    .from("mortgage_notes")
    .update({
      ...noteFields(input),
      ...(clean(input.borrowerTin) ? { borrower_tin_encrypted: encryptTin(input.borrowerTin) } : {}),
      ...(clean(input.lenderTin) ? { lender_tin_encrypted: encryptTin(input.lenderTin) } : {}),
      escrow_account_id: escrowAccountId,
    })
    .eq("id", noteId)
    .eq("organization_id", organizationId);
  if (error) return { success: false, error: error.message };
  if (before.name !== clean(input.name)) {
    for (const [id, name] of [
      [before.note_account_id, names.asset],
      [before.interest_account_id, names.revenue],
      [escrowAccountId, names.liability],
    ]) {
      if (id) await supabase.from("accounts").update({ name }).eq("id", id);
    }
  }

  const kept = await reopenNotePayments(supabase, before);
  const openingError = await setNoteOpening(supabase, organizationId, before.note_account_id, input.balanceAsOf, owedOn(input));
  if (openingError) return { success: false, error: openingError };
  const booked = await bookWaitingPayments(supabase, organizationId, noteId);
  revalidatePath("/properties");
  revalidatePath("/register");
  return { success: true, booked, kept };
}

// Books the borrower's payments waiting in the feed (say, after re-opening
// one that was categorized by hand).
export async function bookPayments(organizationId: string, noteId: string): Promise<Result> {
  if (!(await allowed(organizationId))) return { success: false, error: "You can't change this book" };
  const booked = await bookWaitingPayments(await createClient(), organizationId, noteId);
  revalidatePath("/properties");
  revalidatePath("/register");
  return { success: true, booked };
}

// Stops matching payments to the note. Its accounts and what's booked stay.
export async function deleteNote(organizationId: string, noteId: string): Promise<Result> {
  if (!(await allowed(organizationId))) return { success: false, error: "You can't change this book" };
  const supabase = await createClient();
  const { error } = await supabase.from("mortgage_notes").delete().eq("id", noteId).eq("organization_id", organizationId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/properties");
  return { success: true };
}

export async function get1098(organizationId: string, noteId: string, year: number): Promise<Form1098Report | null> {
  if (!(await allowed(organizationId)) || !Number.isInteger(year) || year < 1900 || year > 2200) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("mortgage_notes")
    .select(
      `${NOTE_COLUMNS}, borrower_address, borrower_tin_encrypted, lender_name, lender_address, lender_tin_encrypted, property_address`,
    )
    .eq("id", noteId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  const figures = await form1098(supabase, toNote(data), year);
  return {
    ...figures,
    note: data.name,
    borrower: { name: data.borrower_name, address: data.borrower_address, tin: revealTin(data.borrower_tin_encrypted) },
    lender: { name: data.lender_name, address: data.lender_address, tin: revealTin(data.lender_tin_encrypted) },
    propertyAddress: data.property_address,
  };
}

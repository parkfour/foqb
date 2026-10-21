// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SupabaseClient } from "@supabase/supabase-js";
import { categorizeByRules } from "@/lib/plaid/processor";
import { bookPendingTransfers } from "@/lib/bank/transfers";
import {
  dayBefore,
  equityAccountId,
  openingEntryLines,
  setOpeningBalance,
  STATEMENT_OPENING_MEMO,
} from "@/lib/bank/opening-balance";
import { signedAmount } from "@/lib/reconcile/shared";
import { readAllRows } from "@/lib/supabase/read-all";
import { statementDifference, type ParsedStatement, type StatementRow } from "./parse";

export interface ImportResult {
  success: boolean;
  error?: string;
  added?: number;
  // Already in the feed (the bank feed got there first, or a re-import).
  alreadyThere?: number;
  // Added rows no rule or transfer match could book.
  uncategorized?: number;
  reconciliationId?: string;
  reconciled?: boolean;
  // Other accounts whose reconciliation this import's transfers completed.
  alsoReconciled?: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 5000;
// Days a statement row and a feed row can differ by and still be one
// transaction (the bank feed and the statement may date it differently).
const MATCH_WINDOW_DAYS = 3;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Pairs each statement row with the feed row it already is: the same
// amount up to MATCH_WINDOW_DAYS away, closest dates first, each feed row
// claimed once. Matching in date order instead would let a daily transfer
// claim the next day's feed row, and the next, and drop rows at the start.
export function matchRows(
  rows: StatementRow[],
  feed: { id: string; date: string; amount: number }[],
): Map<number, { id: string; date: string }> {
  const options: { row: number; f: { id: string; date: string }; gap: number }[] = [];
  rows.forEach((row, i) => {
    const cents = Math.round(row.amount * 100);
    for (const f of feed) {
      const gap = daysBetween(f.date, row.date);
      if (Math.round(Number(f.amount) * 100) === cents && gap <= MATCH_WINDOW_DAYS) options.push({ row: i, f, gap });
    }
  });
  options.sort((a, b) => a.gap - b.gap || a.row - b.row || a.f.id.localeCompare(b.f.id));
  const matches = new Map<number, { id: string; date: string }>();
  const claimed = new Set<string>();
  for (const { row, f } of options) {
    if (matches.has(row) || claimed.has(f.id)) continue;
    matches.set(row, f);
    claimed.add(f.id);
  }
  return matches;
}

// The statement's rows that aren't already in the feed.
export function newRows(rows: StatementRow[], feed: { id: string; date: string; amount: number }[]): StatementRow[] {
  const matches = matchRows(rows, feed);
  return rows.filter((_, i) => !matches.has(i));
}

// A feed row the statement puts in its period but the bank feed dated
// outside it (the feed's purchase date, the statement's posting date)
// takes the statement's date, with its entry, so it's reconciled with this
// statement and not counted in the history before it.
async function moveIntoPeriod(
  supabase: SupabaseClient,
  statement: ParsedStatement,
  matches: Map<number, { id: string; date: string }>,
): Promise<void> {
  for (const [i, f] of matches) {
    const date = statement.rows[i].date;
    const outside = f.date < statement.periodStart || f.date > statement.periodEnd;
    if (!outside || date < statement.periodStart || date > statement.periodEnd) continue;
    const { data: row } = await supabase
      .from("bank_transactions")
      .update({ date })
      .eq("id", f.id)
      .neq("status", "reconciled")
      .select("journal_entry_id")
      .maybeSingle();
    if (!row?.journal_entry_id) continue;
    const { count } = await supabase
      .from("journal_lines")
      .select("id", { count: "exact", head: true })
      .eq("journal_entry_id", row.journal_entry_id)
      .not("reconciliation_id", "is", null);
    if (count) continue;
    const { error } = await supabase.from("journal_entries").update({ entry_date: date }).eq("id", row.journal_entry_id);
    if (error) console.error(`Couldn't move entry ${row.journal_entry_id} to ${date}: ${error.message}`);
  }
}

// The statement comes from the browser, so it's checked again here.
function validStatement(s: ParsedStatement): string | null {
  if (s.kind !== "deposit" && s.kind !== "card") return "Unknown statement type";
  if (!ISO_DATE.test(s.periodStart) || !ISO_DATE.test(s.periodEnd)) return "Bad statement period";
  if (![s.openingBalance, s.closingBalance].every(Number.isFinite)) return "Bad statement balances";
  if (!Array.isArray(s.rows) || s.rows.length > MAX_ROWS) return "Bad statement rows";
  for (const r of s.rows) {
    if (!ISO_DATE.test(r.date) || !Number.isFinite(r.amount) || typeof r.description !== "string") return "Bad statement row";
  }
  if (statementDifference(s) !== 0) return "The statement's transactions don't add up to its closing balance";
  return null;
}

// Adds a statement's transactions to an account's register, books what
// rules and transfer matching can, and reconciles the statement when the
// books allow. The caller has checked that the user may write to orgId.
export async function importStatement(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  accountId: string,
  statement: ParsedStatement,
  options: { settleBefore?: boolean } = {},
): Promise<ImportResult> {
  const invalid = validStatement(statement);
  if (invalid) return { success: false, error: invalid };

  const { data: account } = await supabase
    .from("accounts")
    .select("id, type")
    .eq("id", accountId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!account) return { success: false, error: "Account not found" };
  const expectedType = statement.kind === "card" ? "liability" : "asset";
  if (account.type !== expectedType) {
    return { success: false, error: `A ${statement.kind === "card" ? "card" : "bank"} statement goes in an ${expectedType} account` };
  }

  // Rows already in the bank feed: each statement row claims at most one,
  // the same amount on the nearest date. Rows from statements aren't
  // candidates: a re-import is caught by the stable ids below, and a match
  // against the month before's statement would drop a real repeat (a daily
  // transfer of the same amount either side of the month end).
  const existing = await readAllRows<{ id: string; date: string; amount: number }>((from, to) =>
    supabase
      .from("bank_transactions")
      .select("id, date, amount")
      .eq("account_id", accountId)
      .or("external_account_id.is.null,external_account_id.neq.statement")
      .gte("date", shiftDays(statement.periodStart, -MATCH_WINDOW_DAYS))
      .lte("date", shiftDays(statement.periodEnd, MATCH_WINDOW_DAYS))
      .order("id")
      .range(from, to),
  );
  const matches = matchRows(statement.rows, existing);
  await moveIntoPeriod(supabase, statement, matches);
  const toAdd = statement.rows.filter((_, i) => !matches.has(i));

  // A stable id per statement row, so importing the same statement twice
  // can't add it twice. "statement" marks where it came from; a bank
  // connection made later adopts these rows rather than duplicating them
  // (adoptRelinkedRow).
  const seen = new Map<string, number>();
  const inserts = toAdd.map((row) => {
    const key = `${row.date}:${Math.round(row.amount * 100)}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return {
      organization_id: orgId,
      account_id: accountId,
      external_transaction_id: `statement:${accountId}:${key}:${n}`,
      external_account_id: "statement",
      date: row.date,
      name: row.description.slice(0, 500),
      amount: row.amount,
      status: "unreconciled",
    };
  });
  const added: { id: string; date: string; name: string; amount: number; status: string }[] = [];
  for (let i = 0; i < inserts.length; i += 500) {
    const { data, error } = await supabase
      .from("bank_transactions")
      .upsert(inserts.slice(i, i + 500), { onConflict: "external_transaction_id", ignoreDuplicates: true })
      .select("id, date, name, amount, status");
    if (error) return { success: false, error: `Couldn't add the transactions: ${error.message}` };
    added.push(...(data ?? []));
  }

  // The statement's opening balance is what the account held, so it opens
  // the account (unless an earlier statement already does), even a linked
  // one whose balance worked out from the bank is off while months are
  // missing between the statements and the feed. Once an earlier statement
  // is reconciled, the books already hold it: that one may have opened at
  // zero, which books nothing.
  const { data: reconciledBefore } = await supabase
    .from("bank_reconciliations")
    .select("id")
    .eq("account_id", accountId)
    .eq("status", "completed")
    .lte("statement_date", dayBefore(statement.periodStart))
    .limit(1);
  if (!reconciledBefore?.length) {
    await setOpeningBalance(
      supabase,
      orgId,
      { id: accountId, type: account.type as string },
      dayBefore(statement.periodStart),
      statement.openingBalance,
      STATEMENT_OPENING_MEMO,
    );
  }

  for (const row of added) {
    if (row.status === "unreconciled") await categorizeByRules(supabase, orgId, accountId, { ...row, amount: Number(row.amount) });
  }
  const transferIds = await bookPendingTransfers(supabase, orgId);
  if (options.settleBefore) {
    const error = await settleHistory(supabase, orgId, userId, accountId, account.type as string, statement);
    if (error) return { success: false, error };
  }

  let uncategorized = 0;
  const addedIds = added.map((r) => r.id);
  for (let i = 0; i < addedIds.length; i += 200) {
    const { count } = await supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .in("id", addedIds.slice(i, i + 200))
      .eq("status", "unreconciled");
    uncategorized += count ?? 0;
  }

  const reconciliation = await reconcileStatement(supabase, orgId, userId, accountId, account.type as string, statement);
  const alsoReconciled = await completeCounterparts(supabase, accountId, transferIds);

  return {
    success: true,
    added: added.length,
    alreadyThere: statement.rows.length - added.length,
    uncategorized,
    ...reconciliation,
    alsoReconciled,
  };
}

export const SETTLED_MEMO = "Balance adjustment (history settled)";

// "Everything before this statement is settled": the account's history up
// to the statement is closed at the statement's opening balance. Rows still
// to categorize from before it are ignored (restorable from the register);
// what's booked stays, with one entry against equity for any difference;
// and it all clears in a reconciliation dated the day before the statement.
// Returns an error message, or null.
async function settleHistory(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  accountId: string,
  accountType: string,
  statement: ParsedStatement,
): Promise<string | null> {
  const settleDate = dayBefore(statement.periodStart);
  const { data: settled } = await supabase
    .from("bank_reconciliations")
    .select("id")
    .eq("account_id", accountId)
    .eq("status", "completed")
    .gte("statement_date", settleDate)
    .limit(1);
  if (settled && settled.length > 0) return null; // reconciled through there already

  const { error: ignoreError } = await supabase
    .from("bank_transactions")
    .update({ status: "ignored" })
    .eq("account_id", accountId)
    .eq("status", "unreconciled")
    .lt("date", statement.periodStart);
  if (ignoreError) return `Couldn't set aside the earlier transactions: ${ignoreError.message}`;

  type Line = { id: string; debit: number; credit: number; reconciliation_id: string | null };
  const lines = await readAllRows<Line>((from, to) =>
    supabase
      .from("journal_lines")
      .select("id, debit, credit, reconciliation_id, journal_entries!inner(entry_date, status)")
      .eq("account_id", accountId)
      .eq("journal_entries.status", "posted")
      .lte("journal_entries.entry_date", settleDate)
      .order("id")
      .range(from, to),
  );
  const total = lines.reduce((sum, l) => sum + signedAmount(accountType, Number(l.debit), Number(l.credit)), 0);
  const adjustment = Math.round((statement.openingBalance - total) * 100) / 100;

  const { data: rec, error: recError } = await supabase
    .from("bank_reconciliations")
    .insert({
      organization_id: orgId,
      account_id: accountId,
      statement_date: settleDate,
      statement_ending_balance: statement.openingBalance,
      created_by: userId,
    })
    .select("id")
    .single();
  if (recError || !rec) return "Couldn't start the reconciliation for the earlier history";

  const ids = lines.filter((l) => !l.reconciliation_id).map((l) => l.id);
  if (adjustment !== 0) {
    const equityId = await equityAccountId(supabase, orgId);
    if (!equityId) return "There's no equity account to book the adjustment against";
    const { data: entryId, error } = await supabase.rpc("post_journal_entry", {
      p_org_id: orgId,
      p_entry_date: settleDate,
      p_memo: SETTLED_MEMO,
      p_lines: openingEntryLines(accountType, adjustment, accountId, equityId, SETTLED_MEMO),
    });
    if (error) return `Couldn't book the adjustment: ${error.message}`;
    const { data: adjustmentLines } = await supabase
      .from("journal_lines")
      .select("id")
      .eq("journal_entry_id", entryId)
      .eq("account_id", accountId);
    ids.push(...(adjustmentLines ?? []).map((l) => l.id as string));
  }

  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase
      .from("journal_lines")
      .update({ reconciliation_id: rec.id })
      .in("id", ids.slice(i, i + 200));
    if (error) return `Couldn't clear the earlier history: ${error.message}`;
  }
  await supabase
    .from("bank_reconciliations")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", rec.id);
  return null;
}

// Starts (or picks up) the reconciliation for this statement, then
// completes it if the books through the statement date already come to its
// closing balance: every uncleared line on the account up to then clears.
// Otherwise it's left in progress, for once the rest is categorized.
async function reconcileStatement(
  supabase: SupabaseClient,
  orgId: string,
  userId: string | null,
  accountId: string,
  accountType: string,
  statement: ParsedStatement,
): Promise<{ reconciliationId?: string; reconciled: boolean }> {
  const { data: later } = await supabase
    .from("bank_reconciliations")
    .select("id")
    .eq("account_id", accountId)
    .eq("status", "completed")
    .gte("statement_date", statement.periodEnd)
    .limit(1);
  if (later && later.length > 0) return { reconciled: true }; // already reconciled past this statement

  let { data: rec } = await supabase
    .from("bank_reconciliations")
    .select("id")
    .eq("account_id", accountId)
    .eq("status", "in_progress")
    .eq("statement_date", statement.periodEnd)
    .maybeSingle();
  if (!rec) {
    const { data, error } = await supabase
      .from("bank_reconciliations")
      .insert({
        organization_id: orgId,
        account_id: accountId,
        statement_date: statement.periodEnd,
        statement_ending_balance: statement.closingBalance,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !data) return { reconciled: false };
    rec = data;
  }

  const reconciled = await completeIfBalanced(
    supabase,
    accountId,
    accountType,
    rec.id,
    statement.periodEnd,
    statement.closingBalance,
  );
  return { reconciliationId: rec.id, reconciled };
}

// Completes a reconciliation if the books through its statement date
// already come to its ending balance: every uncleared line on the account up
// to then clears.
async function completeIfBalanced(
  supabase: SupabaseClient,
  accountId: string,
  accountType: string,
  reconciliationId: string,
  statementDate: string,
  endingBalance: number,
): Promise<boolean> {
  // Everything up to the statement date has to be booked first: a total
  // that matches with rows still uncategorized only matches by chance.
  const { count: waiting } = await supabase
    .from("bank_transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("status", "unreconciled")
    .lte("date", statementDate);
  if ((waiting ?? 0) > 0) return false;

  type Line = { id: string; debit: number; credit: number };
  const [cleared, uncleared] = await Promise.all([
    readAllRows<Line>((from, to) =>
      supabase
        .from("journal_lines")
        .select("id, debit, credit")
        .eq("account_id", accountId)
        .not("reconciliation_id", "is", null)
        .order("id")
        .range(from, to),
    ),
    readAllRows<Line>((from, to) =>
      supabase
        .from("journal_lines")
        .select("id, debit, credit, journal_entries!inner(entry_date, status)")
        .eq("account_id", accountId)
        .is("reconciliation_id", null)
        .eq("journal_entries.status", "posted")
        .lte("journal_entries.entry_date", statementDate)
        .order("id")
        .range(from, to),
    ),
  ]);
  const total = (lines: Line[]) =>
    lines.reduce((sum, l) => sum + signedAmount(accountType, Number(l.debit), Number(l.credit)), 0);
  const difference = Math.round((endingBalance - total(cleared) - total(uncleared)) * 100) / 100;
  if (difference !== 0) return false;

  const ids = uncleared.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase
      .from("journal_lines")
      .update({ reconciliation_id: reconciliationId })
      .in("id", ids.slice(i, i + 200));
    if (error) return false;
  }
  await supabase
    .from("bank_reconciliations")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", reconciliationId);
  return true;
}

// A transfer booked by this import may have been all another account's
// statement was waiting for (its side was imported first): finish that
// account's in-progress reconciliations, oldest first, while they balance.
// Returns the accounts that had one completed.
async function completeCounterparts(supabase: SupabaseClient, accountId: string, transferIds: string[]): Promise<string[]> {
  const completed: string[] = [];
  if (transferIds.length === 0) return completed;
  const { data: rows } = await supabase.from("bank_transactions").select("account_id").in("id", transferIds);
  const others = [...new Set((rows ?? []).map((r) => r.account_id as string))].filter((id) => id !== accountId);
  for (const other of others) {
    const [{ data: account }, { data: recs }] = await Promise.all([
      supabase.from("accounts").select("type").eq("id", other).maybeSingle(),
      supabase
        .from("bank_reconciliations")
        .select("id, statement_date, statement_ending_balance")
        .eq("account_id", other)
        .eq("status", "in_progress")
        .order("statement_date"),
    ]);
    if (!account) continue;
    for (const rec of recs ?? []) {
      const done = await completeIfBalanced(
        supabase,
        other,
        account.type as string,
        rec.id as string,
        rec.statement_date as string,
        Number(rec.statement_ending_balance),
      );
      if (!done) break;
      if (!completed.includes(other)) completed.push(other);
    }
  }
  return completed;
}

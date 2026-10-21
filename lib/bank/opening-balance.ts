import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllRows } from "@/lib/supabase/read-all";

// The bank feed only goes back so far (Plaid gives up to two years, some
// banks 90 days), so a linked account's books would start from zero at its
// first imported transaction. Once the bank reports a balance, what the
// account held before that transaction follows from it: the bank's balance
// less everything imported since. That's booked once, the day before the
// first transaction, against equity, so the books can come to match the
// bank once the feed is categorized.
export const OPENING_BALANCE_MEMO = "Opening balance";
// One read off a statement: what the account actually held, so a balance
// worked out from the bank (which is off while months are missing) never
// replaces it.
export const STATEMENT_OPENING_MEMO = "Opening balance (statement)";

interface LinkedAccount {
  id: string;
  type: string;
  bank_balance: number;
}

// What the account held before its first imported row. For a card or loan
// the bank's balance is what's owed and a purchase is a negative row, so
// what was owed then is the balance plus the purchases since.
export function openingBalance(type: string, bankBalance: number, importedTotal: number): number {
  const opening = type === "liability" ? bankBalance + importedTotal : bankBalance - importedTotal;
  return Math.round(opening * 100) / 100;
}

// An asset's opening balance is a debit, a liability's a credit; a negative
// one (an overdraft, a card in credit) is the other way round. Equity takes
// the other side.
export function openingEntryLines(
  type: string,
  opening: number,
  accountId: string,
  equityId: string,
  memo: string = OPENING_BALANCE_MEMO,
) {
  const debitSide = (type === "liability") === opening < 0;
  const amount = Math.abs(opening);
  return [
    { account_id: accountId, debit: debitSide ? amount : 0, credit: debitSide ? 0 : amount, description: memo },
    { account_id: equityId, debit: debitSide ? 0 : amount, credit: debitSide ? amount : 0, description: memo },
  ];
}

export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function equityAccountId(supabase: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("type", "equity")
    .eq("is_active", true)
    .order("account_number")
    .limit(1)
    .maybeSingle();
  if (!data) console.error(`No equity account to book opening balances against in organization ${organizationId}`);
  return (data?.id as string | undefined) ?? null;
}

// Books `opening` as the account's opening balance on `date`, against
// equity. One already there before that date stays (an earlier statement's).
// One that's later (the account now goes back further) or for a different
// amount (missing months since filled in) is voided and replaced, unless a
// reconciliation has cleared it. One the user voided stays voided, and
// one from a statement stays unless another statement replaces it.
export async function setOpeningBalance(
  supabase: SupabaseClient,
  organizationId: string,
  account: { id: string; type: string },
  date: string,
  opening: number,
  memo: string = OPENING_BALANCE_MEMO,
): Promise<void> {
  const { data: existing } = await supabase
    .from("journal_lines")
    .select("debit, credit, reconciliation_id, journal_entries!inner(id, status, entry_date, memo)")
    .eq("account_id", account.id)
    .in("journal_entries.memo", [OPENING_BALANCE_MEMO, STATEMENT_OPENING_MEMO]);
  const booked = (existing ?? []) as unknown as {
    debit: number;
    credit: number;
    reconciliation_id: string | null;
    journal_entries: { id: string; status: string; entry_date: string; memo: string };
  }[];
  const live = booked.find((b) => b.journal_entries.status !== "void");
  if (!live && booked.length > 0) return; // voided by the user
  if (live) {
    const bookedAmount =
      account.type === "liability" ? Number(live.credit) - Number(live.debit) : Number(live.debit) - Number(live.credit);
    const sameAmount = Math.round(bookedAmount * 100) === Math.round(opening * 100);
    if (live.reconciliation_id || live.journal_entries.entry_date < date) return;
    if (live.journal_entries.memo === STATEMENT_OPENING_MEMO && memo !== STATEMENT_OPENING_MEMO) return;
    if (live.journal_entries.entry_date === date && sameAmount && live.journal_entries.memo === memo) return;
    const { error } = await supabase
      .from("journal_entries")
      .update({ status: "void" })
      .eq("id", live.journal_entries.id)
      .eq("status", "posted");
    if (error) {
      console.error(`Failed to void the old opening balance for account ${account.id}`, error);
      return;
    }
  }
  if (opening === 0) return;

  const equityId = await equityAccountId(supabase, organizationId);
  if (!equityId) return;
  const { error } = await supabase.rpc("post_journal_entry", {
    p_org_id: organizationId,
    p_entry_date: date,
    p_memo: memo,
    p_lines: openingEntryLines(account.type, opening, account.id, equityId, memo),
  });
  if (error) console.error(`Failed to book the opening balance for account ${account.id}`, error);
}

// For each linked account with a bank balance: what it held before its
// first transaction, worked out from that balance, booked the day before.
export async function bookOpeningBalances(supabase: SupabaseClient, organizationId: string): Promise<void> {
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, type, bank_balance")
    .eq("organization_id", organizationId)
    .not("bank_balance", "is", null);

  for (const account of (accounts ?? []) as LinkedAccount[]) {
    const rows = await readAllRows<{ date: string; amount: number }>((from, to) =>
      supabase.from("bank_transactions").select("date, amount").eq("account_id", account.id).order("id").range(from, to),
    );
    if (rows.length === 0) continue;
    const firstDate = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
    const importedTotal = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const opening = openingBalance(account.type, Number(account.bank_balance), importedTotal);
    await setOpeningBalance(supabase, organizationId, account, dayBefore(firstDate), opening);
  }
}

// Booking one event in two of your own books. Each book's side is a debit
// to one account and a credit to another, for the same amount.

export type BetweenBooksKind = "transfer" | "paid_for";

export interface BookSide {
  orgId: string;
  debitAccountId: string;
  creditAccountId: string;
  bankTransactionId?: string | null;
}

// The labels for each book's two accounts, by kind. "This book" is the
// one money leaves (or that paid); "the other book" is where it arrives
// (or whose expense it was).
export const KINDS: Record<
  BetweenBooksKind,
  { label: string; hint: string; thisDebit: string; thisCredit: string; otherDebit: string; otherCredit: string }
> = {
  transfer: {
    label: "Money moved from this book to the other",
    hint: "An owner's draw (business to household) or money put into a business (household to business).",
    thisDebit: "Recorded here as (e.g. Owner's draw, or Investment in the business)",
    thisCredit: "Paid from (the bank account it left)",
    otherDebit: "Received into (the bank account it arrived in)",
    otherCredit: "Recorded there as (e.g. Draws from the business, or Owner's contribution)",
  },
  paid_for: {
    label: "This book paid the other book's expense",
    hint: "A business expense put on a personal card, say: the expense goes in the business's books, and the household records what the business owes it.",
    thisDebit: "Recorded here as (e.g. Owed by the business, an asset)",
    thisCredit: "Paid from (the card or bank account)",
    otherDebit: "The expense",
    otherCredit: "Recorded there as (e.g. Owed to the owner, a liability, or Owner's contribution)",
  },
};

export function sideLines(side: BookSide, amount: number) {
  return [
    { account_id: side.debitAccountId, debit: amount, credit: 0 },
    { account_id: side.creditAccountId, debit: 0, credit: amount },
  ];
}

export function validateBetweenBooks(input: {
  kind: string;
  date: string;
  amount: number;
  a: BookSide;
  b: BookSide;
}): string | null {
  if (!(input.kind in KINDS)) return "Choose what happened";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Choose a date";
  if (!(input.amount > 0) || Math.abs(Math.round(input.amount * 100) - input.amount * 100) > 1e-6) return "Enter an amount above zero, to the cent";
  if (input.a.orgId === input.b.orgId) return "Choose the other book";
  for (const side of [input.a, input.b]) {
    if (!side.debitAccountId || !side.creditAccountId) return "Choose both accounts in each book";
    if (side.debitAccountId === side.creditAccountId) return "Each book's two accounts must differ";
  }
  return null;
}

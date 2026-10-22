import { pairTransfers } from "@/lib/bank/transfers";
import type { RegisterTransaction } from "@/components/transactions/transaction-register";

interface RawJournalLine {
  id: string;
  account_id: string;
  description?: string | null;
  debit: number;
  credit: number;
  reconciliation_id?: string | null;
  accounts?: { name: string } | null;
}

export interface RawTx {
  id: string;
  date: string;
  name: string;
  amount: number;
  status: string;
  cleared?: boolean | null;
  account_id?: string | null;
  journal_entry_id?: string | null;
  reopen_blocker?: string | null;
  recategorize_blocker?: string | null;
  accounts?: { name: string } | null;
  journal_entries?: {
    status: string;
    journal_lines?: RawJournalLine[];
  } | null;
}

// The register's rows from bank transactions as read with their entries:
// each one's category (or Split, Uncategorized, Ignored), whether a
// reconciliation covers it, and the other side of a transfer it looks like.
export function registerRows(raw: RawTx[]): RegisterTransaction[] {
  const transactions: RegisterTransaction[] = raw.map((t) => {
    const journalLines: RawJournalLine[] = t.journal_entries?.journal_lines ?? [];
    const nonBankLines = journalLines.filter((l) => l.account_id !== t.account_id);
    const isSplit = nonBankLines.length > 1;

    let categoryName = t.status === "ignored" ? "Ignored" : "Uncategorized";
    let categoryId: string | null = null;

    if (isSplit) {
      categoryName = "Split";
    } else if (nonBankLines.length === 1) {
      categoryName = nonBankLines[0].accounts?.name || "Categorized";
      categoryId = nonBankLines[0].account_id;
    }

    // Reconciled means a bank reconciliation covers the bank account's line.
    const isReconciled = journalLines.some((l) => l.account_id === t.account_id && Boolean(l.reconciliation_id));
    const status: "pending" | "cleared" | "reconciled" = isReconciled
      ? "reconciled"
      : t.cleared
      ? "cleared"
      : "pending";

    return {
      id: t.id,
      date: t.date,
      account_id: t.account_id || "",
      account_name: t.accounts?.name || "Primary Account",
      name: t.name,
      amount: Number(t.amount),
      category_id: categoryId,
      category_name: categoryName,
      is_split: isSplit,
      status,
      categorized: t.status !== "unreconciled",
      ignored: t.status === "ignored",
      journal_entry_id: t.journal_entry_id,
      reopen_blocker: t.reopen_blocker ?? null,
      recategorize_blocker: t.recategorize_blocker ?? null,
    };
  });

  const transfers = pairTransfers(transactions.filter((t) => !t.categorized));
  for (const t of transactions) {
    const other = transfers.get(t.id);
    if (other) t.transfer = { account_id: other.account_id, account_name: other.account_name };
  }

  return transactions;
}

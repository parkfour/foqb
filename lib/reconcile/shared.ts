// Split from index.ts because index.ts also exports server-only data
// fetchers (createClient, which depends on next/headers) — the worksheet
// client component needs signedAmount/ReconciliationLine without pulling
// that in, which crashes the client bundle.
export interface ReconciliationLine {
  id: string;
  entryDate: string;
  memo: string | null;
  description: string | null;
  debit: number;
  credit: number;
}

// Assets increase with debits; liabilities (and everything else that can be
// reconciled, e.g. a credit card) increase with credits.
export function signedAmount(accountType: string, debit: number, credit: number): number {
  return accountType === "asset" ? debit - credit : credit - debit;
}

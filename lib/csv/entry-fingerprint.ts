import { createHash } from "node:crypto";

// An imported entry's external id: its ref, date, memo and lines, so the
// same entry from the same file (or a re-export of it) is recognized, and
// a changed one isn't.
export function entryFingerprint(entry: {
  ref: string;
  entryDate: string;
  memo: string;
  lines: { accountNumber: string; debit: number; credit: number }[];
}): string {
  const lines = entry.lines
    .map((l) => `${l.accountNumber}|${l.debit.toFixed(2)}|${l.credit.toFixed(2)}`)
    .sort()
    .join(";");
  return createHash("sha256").update([entry.ref, entry.entryDate, entry.memo, lines].join("\n")).digest("hex").slice(0, 40);
}

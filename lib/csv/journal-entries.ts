import Papa from "papaparse";
import { CSV_EXPORT_OPTIONS, unescapeFormula } from "./formula";

interface JournalEntryCsvRow {
  entry_ref: string;
  entry_date: string;
  memo: string;
  account_number: string;
  debit: string;
  credit: string;
}

export interface ExportableJournalLine {
  entry_ref: string;
  entry_date: string;
  memo: string | null;
  account_number: string;
  debit: number;
  credit: number;
}

export function journalEntriesToCsv(rows: ExportableJournalLine[]): string {
  return Papa.unparse({
    fields: ["entry_ref", "entry_date", "memo", "account_number", "debit", "credit"],
    data: rows.map((r) => [
      r.entry_ref,
      r.entry_date,
      r.memo ?? "",
      r.account_number,
      r.debit.toFixed(2),
      r.credit.toFixed(2),
    ]),
  }, CSV_EXPORT_OPTIONS);
}

export interface JournalEntryLineRecord {
  accountNumber: string;
  debit: number;
  credit: number;
}

export interface JournalEntryRecord {
  ref: string;
  entryDate: string;
  memo: string;
  lines: JournalEntryLineRecord[];
}

export interface ParsedJournalEntriesResult {
  entries: JournalEntryRecord[];
  errors: string[];
}

// Shared by every journal-entry CSV format (native + Wave): entries that
// fail the balance check are excluded from the returned `entries` (not
// just flagged in `errors`), so callers never attempt to persist something
// already known to be broken — the balance trigger would reject it again
// at insert time with a redundant second error.
export function filterBalancedEntries<T extends { ref: string; lines: { debit: number; credit: number }[] }>(
  grouped: Map<string, T>,
): { entries: T[]; errors: string[] } {
  const errors: string[] = [];
  const unbalancedRefs = new Set<string>();

  for (const entry of grouped.values()) {
    const totalDebit = entry.lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = entry.lines.reduce((sum, l) => sum + l.credit, 0);

    if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
      errors.push(
        `Entry ${entry.ref}: total debits (${totalDebit}) do not equal total credits (${totalCredit})`,
      );
      unbalancedRefs.add(entry.ref);
    }
  }

  const entries = Array.from(grouped.values()).filter((entry) => !unbalancedRefs.has(entry.ref));
  return { entries, errors };
}

export function parseJournalEntriesCsv(csvText: string): ParsedJournalEntriesResult {
  const parsed = Papa.parse<JournalEntryCsvRow>(csvText, { header: true, skipEmptyLines: true, transform: unescapeFormula });
  const errors: string[] = [...parsed.errors.map((e) => `Row ${e.row ?? "?"}: ${e.message}`)];
  const grouped = new Map<string, JournalEntryRecord>();

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const ref = row.entry_ref?.trim();
    const entryDate = row.entry_date?.trim();
    const accountNumber = row.account_number?.trim();
    const debit = Number(row.debit?.trim() || 0);
    const credit = Number(row.credit?.trim() || 0);

    if (!ref || !entryDate || !accountNumber) {
      errors.push(`Row ${rowNumber}: entry_ref, entry_date, and account_number are required`);
      return;
    }

    if (Number.isNaN(debit) || Number.isNaN(credit)) {
      errors.push(`Row ${rowNumber}: debit and credit must be numbers`);
      return;
    }

    if (!((debit > 0 && credit === 0) || (credit > 0 && debit === 0))) {
      errors.push(`Row ${rowNumber}: exactly one of debit or credit must be greater than zero`);
      return;
    }

    const line: JournalEntryLineRecord = { accountNumber, debit, credit };
    const existing = grouped.get(ref);

    if (existing) {
      existing.lines.push(line);
    } else {
      grouped.set(ref, {
        ref,
        entryDate,
        memo: row.memo?.trim() ?? "",
        lines: [line],
      });
    }
  });

  const balanced = filterBalancedEntries(grouped);
  return { entries: balanced.entries, errors: [...errors, ...balanced.errors] };
}

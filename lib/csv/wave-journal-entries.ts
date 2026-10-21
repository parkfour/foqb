import Papa from "papaparse";
import type { AccountType } from "./accounts";
import { filterBalancedEntries } from "./journal-entries";

interface WaveCsvRow {
  "Transaction ID": string;
  "Transaction Date": string;
  "Account Name": string;
  "Transaction Description": string;
  "Notes / Memo": string;
  "Debit Amount (Two Column Approach)": string;
  "Credit Amount (Two Column Approach)": string;
  "Account Group": string;
}

const ACCOUNT_GROUP_TO_TYPE: Record<string, AccountType> = {
  asset: "asset",
  liability: "liability",
  equity: "equity",
  income: "revenue",
  expense: "expense",
};

export interface WaveJournalLineRecord {
  accountName: string;
  accountType: AccountType;
  debit: number;
  credit: number;
}

export interface WaveJournalEntryRecord {
  ref: string;
  entryDate: string;
  memo: string;
  lines: WaveJournalLineRecord[];
}

export interface ParsedWaveJournalEntriesResult {
  entries: WaveJournalEntryRecord[];
  errors: string[];
}

// Wave's "Account Transactions" export: one row per leg of a transaction
// (rows sharing a Transaction ID), account identified by name (no account
// number), amount split across explicit two-column debit/credit fields.
export function isWaveJournalCsv(csvText: string): boolean {
  const firstLine = csvText.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes("Transaction ID") && firstLine.includes("Account Name");
}

export function parseWaveJournalEntriesCsv(csvText: string): ParsedWaveJournalEntriesResult {
  const parsed = Papa.parse<WaveCsvRow>(csvText, { header: true, skipEmptyLines: true });
  const errors: string[] = [...parsed.errors.map((e) => `Row ${e.row ?? "?"}: ${e.message}`)];
  const grouped = new Map<string, WaveJournalEntryRecord>();

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const ref = row["Transaction ID"]?.trim();
    const entryDate = row["Transaction Date"]?.trim();
    const accountName = row["Account Name"]?.trim();
    const accountType = ACCOUNT_GROUP_TO_TYPE[row["Account Group"]?.trim().toLowerCase() ?? ""];

    if (!ref || !entryDate || !accountName || !accountType) {
      errors.push(
        `Row ${rowNumber}: Transaction ID, Transaction Date, Account Name, and a recognized Account Group are required`,
      );
      return;
    }

    const debit = Number(row["Debit Amount (Two Column Approach)"]?.trim() || 0);
    const credit = Number(row["Credit Amount (Two Column Approach)"]?.trim() || 0);

    if (Number.isNaN(debit) || Number.isNaN(credit)) {
      errors.push(`Row ${rowNumber}: debit and credit must be numbers`);
      return;
    }

    if (!((debit > 0 && credit === 0) || (credit > 0 && debit === 0))) {
      errors.push(`Row ${rowNumber}: exactly one of debit or credit must be greater than zero`);
      return;
    }

    const line: WaveJournalLineRecord = { accountName, accountType, debit, credit };
    const existing = grouped.get(ref);

    if (existing) {
      existing.lines.push(line);
    } else {
      grouped.set(ref, {
        ref,
        entryDate,
        memo: row["Transaction Description"]?.trim() || row["Notes / Memo"]?.trim() || "",
        lines: [line],
      });
    }
  });

  const balanced = filterBalancedEntries(grouped);
  return { entries: balanced.entries, errors: [...errors, ...balanced.errors] };
}

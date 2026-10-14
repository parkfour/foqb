import Papa from "papaparse";
import { CSV_EXPORT_OPTIONS, unescapeFormula } from "./formula";

const ACCOUNT_TYPES = new Set(["asset", "liability", "equity", "revenue", "expense"]);

// Blank/unrecognized values default to active (existing behavior); only
// these recognized "falsy" spellings mark an account inactive.
const INACTIVE_VALUES = new Set(["false", "no", "n", "0", "f", "off", "inactive"]);

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

interface AccountCsvRow {
  account_number: string;
  name: string;
  type: string;
  description: string;
  is_active: string;
}

export interface ExportableAccount {
  account_number: string;
  name: string;
  type: string;
  description: string | null;
  is_active: boolean;
}

export function accountsToCsv(accounts: ExportableAccount[]): string {
  return Papa.unparse({
    fields: ["account_number", "name", "type", "description", "is_active"],
    data: accounts.map((a) => [
      a.account_number,
      a.name,
      a.type,
      a.description ?? "",
      a.is_active ? "true" : "false",
    ]),
  }, CSV_EXPORT_OPTIONS);
}

export interface AccountRecord {
  account_number: string;
  name: string;
  type: AccountType;
  description: string | null;
  is_active: boolean;
}

export interface ParsedAccountsResult {
  records: AccountRecord[];
  errors: string[];
}

export function parseAccountsCsv(csvText: string): ParsedAccountsResult {
  const parsed = Papa.parse<AccountCsvRow>(csvText, { header: true, skipEmptyLines: true, transform: unescapeFormula });
  const records: AccountRecord[] = [];
  const errors: string[] = [...parsed.errors.map((e) => `Row ${e.row ?? "?"}: ${e.message}`)];

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for header row, +1 for 1-indexing
    const accountNumber = row.account_number?.trim();
    const name = row.name?.trim();
    const type = row.type?.trim().toLowerCase();

    if (!accountNumber || !name || !type) {
      errors.push(`Row ${rowNumber}: account_number, name, and type are required`);
      return;
    }

    if (!ACCOUNT_TYPES.has(type)) {
      errors.push(`Row ${rowNumber}: invalid type "${type}"`);
      return;
    }

    records.push({
      account_number: accountNumber,
      name,
      type: type as AccountType,
      description: row.description?.trim() || null,
      is_active: !INACTIVE_VALUES.has(row.is_active?.trim().toLowerCase() ?? ""),
    });
  });

  return { records, errors };
}

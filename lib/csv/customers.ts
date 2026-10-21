import Papa from "papaparse";

// Same falsy-spelling set already established for accounts/journal-entries
// CSV import — blank/unrecognized values default to active.
const INACTIVE_VALUES = new Set(["false", "no", "n", "0", "f", "off", "inactive"]);

interface CustomerCsvRow {
  name: string;
  customer_name: string;
  email: string;
  phone: string;
  billing_address: string;
  is_active: string;
}

export interface CustomerRecord {
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: string | null;
  is_active: boolean;
}

export interface ParsedCustomersResult {
  records: CustomerRecord[];
  errors: string[];
}

export function parseCustomersCsv(csvText: string): ParsedCustomersResult {
  const parsed = Papa.parse<CustomerCsvRow>(csvText, { header: true, skipEmptyLines: true });
  const records: CustomerRecord[] = [];
  const errors: string[] = [...parsed.errors.map((e) => `Row ${e.row ?? "?"}: ${e.message}`)];

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for header row, +1 for 1-indexing
    const name = row.name?.trim() || row.customer_name?.trim();

    if (!name) {
      errors.push(`Row ${rowNumber}: name is required`);
      return;
    }

    records.push({
      name,
      email: row.email?.trim() || null,
      phone: row.phone?.trim() || null,
      billing_address: row.billing_address?.trim() || null,
      is_active: !INACTIVE_VALUES.has(row.is_active?.trim().toLowerCase() ?? ""),
    });
  });

  return { records, errors };
}

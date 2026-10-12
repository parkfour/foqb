import Papa from "papaparse";

const INACTIVE_VALUES = new Set(["false", "no", "n", "0", "f", "off", "inactive"]);

interface VendorCsvRow {
  name: string;
  vendor_name: string;
  email: string;
  phone: string;
  address: string;
  is_active: string;
}

export interface VendorRecord {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
}

export interface ParsedVendorsResult {
  records: VendorRecord[];
  errors: string[];
}

export function parseVendorsCsv(csvText: string): ParsedVendorsResult {
  const parsed = Papa.parse<VendorCsvRow>(csvText, { header: true, skipEmptyLines: true });
  const records: VendorRecord[] = [];
  const errors: string[] = [...parsed.errors.map((e) => `Row ${e.row ?? "?"}: ${e.message}`)];

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = row.name?.trim() || row.vendor_name?.trim();

    if (!name) {
      errors.push(`Row ${rowNumber}: name is required`);
      return;
    }

    records.push({
      name,
      email: row.email?.trim() || null,
      phone: row.phone?.trim() || null,
      address: row.address?.trim() || null,
      is_active: !INACTIVE_VALUES.has(row.is_active?.trim().toLowerCase() ?? ""),
    });
  });

  return { records, errors };
}

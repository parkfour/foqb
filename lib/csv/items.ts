import Papa from "papaparse";

const INACTIVE_VALUES = new Set(["false", "no", "n", "0", "f", "off", "inactive"]);
const TRUE_VALUES = new Set(["true", "yes", "y", "1"]);

interface ItemCsvRow {
  name: string;
  item_name: string;
  description: string;
  income_account_number: string;
  sale_price: string;
  track_quantity: string;
  quantity_on_hand: string;
  is_active: string;
}

export interface ItemRecord {
  name: string;
  description: string | null;
  // Resolved to income_account_id by the route, which has org-scoped DB
  // access the parser doesn't — same split as journal-entries CSV import.
  income_account_number: string;
  sale_price: number | null;
  track_quantity: boolean;
  quantity_on_hand: number;
  is_active: boolean;
}

export interface ParsedItemsResult {
  records: ItemRecord[];
  errors: string[];
}

export function parseItemsCsv(csvText: string): ParsedItemsResult {
  const parsed = Papa.parse<ItemCsvRow>(csvText, { header: true, skipEmptyLines: true });
  const records: ItemRecord[] = [];
  const errors: string[] = [...parsed.errors.map((e) => `Row ${e.row ?? "?"}: ${e.message}`)];

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = row.name?.trim() || row.item_name?.trim();
    const incomeAccountNumber = row.income_account_number?.trim();

    if (!name || !incomeAccountNumber) {
      errors.push(`Row ${rowNumber}: name and income_account_number are required`);
      return;
    }

    const salePriceRaw = row.sale_price?.trim();
    const salePrice = salePriceRaw ? Number(salePriceRaw) : null;
    if (salePriceRaw && Number.isNaN(salePrice)) {
      errors.push(`Row ${rowNumber}: invalid sale_price "${salePriceRaw}"`);
      return;
    }

    const quantityRaw = row.quantity_on_hand?.trim();
    const quantityOnHand = quantityRaw ? Number(quantityRaw) : 0;
    if (quantityRaw && Number.isNaN(quantityOnHand)) {
      errors.push(`Row ${rowNumber}: invalid quantity_on_hand "${quantityRaw}"`);
      return;
    }

    records.push({
      name,
      description: row.description?.trim() || null,
      income_account_number: incomeAccountNumber,
      sale_price: salePrice,
      track_quantity: TRUE_VALUES.has(row.track_quantity?.trim().toLowerCase() ?? ""),
      quantity_on_hand: quantityOnHand,
      is_active: !INACTIVE_VALUES.has(row.is_active?.trim().toLowerCase() ?? ""),
    });
  });

  return { records, errors };
}

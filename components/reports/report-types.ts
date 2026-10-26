// Reports that cover a date range (start and end) rather than one as-of date.
export const RANGE_REPORTS: ReadonlySet<string> = new Set([
  "income-statement",
  "cash-flow-statement",
  "general-ledger",
  "income-statement-by-class",
  "tax-line-items",
  "sales-tax",
]);

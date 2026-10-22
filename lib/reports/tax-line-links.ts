// The page listing what a tax line adds up, with each account's
// transactions: one line (and property, for one kept per rental), or the
// accounts with no line, of one type, over a period.
export function taxLineAccountsHref(
  row: { tax_line_id: string | null; property_id: string | null; account_type: "revenue" | "expense" },
  start: string,
  end: string,
): string {
  const params = new URLSearchParams({ start, end, type: row.account_type });
  if (row.tax_line_id) {
    params.set("taxLineId", row.tax_line_id);
    if (row.property_id) params.set("propertyId", row.property_id);
  } else {
    params.set("unassigned", "true");
  }
  return `/reports/tax-line/accounts?${params.toString()}`;
}

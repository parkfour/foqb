// Billable hours not on a live invoice, as invoice lines: hours at the
// entry's rate, or else the item's sale price, to the item's income account.
// Entries with no item or no rate can't be invoiced and are left out.

export interface UnbilledEntry {
  id: string;
  work_date: string;
  hours: number;
  description: string | null;
  rate: number | null;
  item_id: string | null;
  items: { name: string; income_account_id: string; sale_price: number | null } | null;
  invoices: { status: string } | null;
}

export const isUnbilled = (e: Pick<UnbilledEntry, "invoices">): boolean => !e.invoices || e.invoices.status === "void";

export function timeInvoiceLines(entries: UnbilledEntry[]) {
  const billed: string[] = [];
  const lines = entries.flatMap((e) => {
    const rate = e.rate ?? e.items?.sale_price ?? null;
    if (!e.item_id || !e.items || rate == null || Number(rate) <= 0) return [];
    billed.push(e.id);
    return [
      {
        item_id: e.item_id,
        account_id: e.items.income_account_id,
        description: [e.work_date, e.items.name, e.description].filter(Boolean).join(" · "),
        quantity: Number(e.hours),
        unit_price: Number(rate),
      },
    ];
  });
  return { lines, billed };
}

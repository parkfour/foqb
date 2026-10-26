import { describe, expect, it } from "vitest";
import { isUnbilled, timeInvoiceLines, type UnbilledEntry } from "@/lib/ar/time";

const entry = (over: Partial<UnbilledEntry>): UnbilledEntry => ({
  id: "e",
  work_date: "2026-10-01",
  hours: 2,
  description: "Design",
  rate: null,
  item_id: "consulting",
  items: { name: "Consulting", income_account_id: "fees", sale_price: 100 },
  invoices: null,
  ...over,
});

describe("timeInvoiceLines", () => {
  it("bills hours at the entry's rate, else the item's price, and skips what can't be priced", () => {
    const { lines, billed } = timeInvoiceLines([
      entry({ id: "a" }),
      entry({ id: "b", rate: 150, hours: 1.5 }),
      entry({ id: "c", item_id: null, items: null }),
      entry({ id: "d", items: { name: "Free", income_account_id: "fees", sale_price: null } }),
    ]);
    expect(billed).toEqual(["a", "b"]);
    expect(lines).toEqual([
      { item_id: "consulting", account_id: "fees", description: "2026-10-01 · Consulting · Design", quantity: 2, unit_price: 100 },
      { item_id: "consulting", account_id: "fees", description: "2026-10-01 · Consulting · Design", quantity: 1.5, unit_price: 150 },
    ]);
  });

  it("treats hours on a voided invoice as unbilled", () => {
    expect(isUnbilled(entry({ invoices: { status: "void" } }))).toBe(true);
    expect(isUnbilled(entry({ invoices: { status: "open" } }))).toBe(false);
  });
});

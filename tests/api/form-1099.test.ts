import { describe, expect, it } from "vitest";
import { nec1099Threshold, summarize1099 } from "@/lib/reports/form-1099";

const vendors = [
  { id: "v1", name: "Pat Plumbing", address: "1 Main St" },
  { id: "v2", name: "Sam Design", address: null },
];
const pay = (vendor_id: string, amount: number, type = "asset", status = "paid") => ({
  amount,
  payment_date: "2026-03-01",
  accounts: { type },
  bills: { vendor_id, status },
});

describe("1099-NEC", () => {
  it("uses $600 through 2025 and $2,000 from 2026", () => {
    expect(nec1099Threshold(2025)).toBe(600);
    expect(nec1099Threshold(2026)).toBe(2000);
  });

  it("totals bank payments per vendor, sets card payments aside and skips void bills", () => {
    const rows = summarize1099(
      vendors,
      [pay("v1", 1500), pay("v1", 600.25), pay("v1", 300, "liability"), pay("v2", 900), pay("v2", 5000, "asset", "void")],
      2026,
    );
    expect(rows).toEqual([
      { vendorId: "v1", name: "Pat Plumbing", address: "1 Main St", paid: 2100.25, byCard: 300, meetsThreshold: true },
      { vendorId: "v2", name: "Sam Design", address: null, paid: 900, byCard: 0, meetsThreshold: false },
    ]);
    expect(summarize1099(vendors, [pay("v2", 900)], 2025)[0]).toMatchObject({ vendorId: "v2", meetsThreshold: true });
  });
});

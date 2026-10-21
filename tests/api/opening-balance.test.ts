import { describe, expect, it } from "vitest";
import { openingBalance, openingEntryLines } from "@/lib/bank/opening-balance";

describe("openingBalance", () => {
  it("is a bank account's balance less what was imported since", () => {
    // $1,000 now, after $300 in and $50 out: $750 before the first row.
    expect(openingBalance("asset", 1000, 300 - 50)).toBe(750);
  });

  it("is a card's balance owed plus the purchases since", () => {
    // $400 owed now, after $500 of purchases and a $200 payment: $100 owed before.
    expect(openingBalance("liability", 400, -500 + 200)).toBe(100);
  });
});

describe("openingEntryLines", () => {
  const debitOf = (lines: ReturnType<typeof openingEntryLines>, id: string) =>
    lines.find((l) => l.account_id === id)!.debit - lines.find((l) => l.account_id === id)!.credit;

  it("debits a bank account's opening balance against equity", () => {
    const lines = openingEntryLines("asset", 750, "bank", "equity");
    expect(debitOf(lines, "bank")).toBe(750);
    expect(debitOf(lines, "equity")).toBe(-750);
  });

  it("credits what was owed on a card", () => {
    expect(debitOf(openingEntryLines("liability", 100, "card", "equity"), "card")).toBe(-100);
  });

  it("flips for an overdraft or a card in credit", () => {
    expect(debitOf(openingEntryLines("asset", -20, "bank", "equity"), "bank")).toBe(-20);
    expect(debitOf(openingEntryLines("liability", -15, "card", "equity"), "card")).toBe(15);
  });
});

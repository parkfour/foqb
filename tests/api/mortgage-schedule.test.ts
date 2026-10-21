import { describe, expect, it } from "vitest";
import { levelPayment, scheduledBalance, splitPayment } from "@/plugins/mortgage-notes/schedule";
import { noteForPayment } from "@/plugins/mortgage-notes/notes";

describe("mortgage schedule", () => {
  it("figures the level payment", () => {
    // $100,000 at 6% over 30 years.
    expect(levelPayment(100_000, 6, 360)).toBe(599.55);
    expect(levelPayment(1200, 0, 12)).toBe(100);
  });

  it("splits an on-time payment into the month's interest, escrow, then principal", () => {
    expect(splitPayment(599.55 + 250, 100_000, 6, 250)).toEqual({ interest: 500, escrow: 250, principal: 99.55 });
  });

  it("puts an extra amount on principal, and a short one on interest first", () => {
    expect(splitPayment(700, 100_000, 6, 0).principal).toBe(200);
    expect(splitPayment(300, 100_000, 6, 250)).toEqual({ interest: 300, escrow: 0, principal: 0 });
  });

  it("follows the schedule's balance", () => {
    const terms = { originalPrincipal: 100_000, annualRate: 6, paymentAmount: 599.55, firstPaymentDate: "2025-02-01" };
    expect(scheduledBalance(terms, "2025-01-31")).toBe(100_000);
    expect(scheduledBalance(terms, "2025-02-01")).toBe(99_900.45);
    expect(scheduledBalance(terms, "2025-03-15")).toBe(99_800.4);
  });
});

describe("noteForPayment", () => {
  const notes = [{ match_text: "Jane Borrower" }] as Parameters<typeof noteForPayment>[0];

  it("takes a deposit naming the borrower as theirs", () => {
    expect(noteForPayment(notes, "Zelle payment from JANE BORROWER Conf# 123", 1000)).toBe(notes[0]);
  });

  it("leaves the renter's Zelle, and money going out, to the rules", () => {
    expect(noteForPayment(notes, "Zelle payment from BRIAN RENTER", 1000)).toBeNull();
    expect(noteForPayment(notes, "Zelle payment to JANE BORROWER", -1000)).toBeNull();
  });
});

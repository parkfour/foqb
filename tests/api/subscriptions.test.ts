import { describe, expect, it } from "vitest";
import { detectRecurring, merchantKey } from "@/lib/subscriptions/detect";

describe("merchantKey", () => {
  it("treats a merchant's varying feed names as one", () => {
    expect(merchantKey("NETFLIX.COM 866-579 CA #1234")).toBe(merchantKey("Netflix.com"));
    expect(merchantKey("POS DEBIT SPOTIFY USA")).toBe("spotify usa");
  });
});

describe("detectRecurring", () => {
  it("finds a monthly charge, its next date and yearly cost, and ignores one-offs and income", () => {
    const found = detectRecurring([
      { date: "2026-07-03", name: "NETFLIX.COM #1", amount: -15.49 },
      { date: "2026-08-03", name: "NETFLIX.COM #2", amount: -15.49 },
      { date: "2026-09-02", name: "Netflix.com", amount: -17.99 },
      { date: "2026-10-03", name: "NETFLIX.COM", amount: -17.99 },
      { date: "2026-08-14", name: "HARDWARE STORE", amount: -82.1 },
      { date: "2026-09-20", name: "HARDWARE STORE", amount: -12 },
      { date: "2026-10-01", name: "PAYROLL", amount: 3000 },
      { date: "2026-09-01", name: "PAYROLL", amount: 3000 },
      { date: "2026-08-01", name: "PAYROLL", amount: 3000 },
    ]);
    expect(found).toEqual([
      { merchant: "NETFLIX.COM #1", cadence: "monthly", typical: 16.74, count: 4, last: "2026-10-03", next: "2026-11-02", perYear: 200.88 },
    ]);
  });

  it("finds a yearly renewal from two charges", () => {
    const [found] = detectRecurring([
      { date: "2025-03-10", name: "Domain renewal", amount: -20 },
      { date: "2026-03-11", name: "DOMAIN RENEWAL", amount: -20 },
    ]);
    expect(found).toMatchObject({ cadence: "yearly", perYear: 20, next: "2027-03-11" });
  });

  it("skips a merchant whose amounts swing", () => {
    expect(
      detectRecurring([
        { date: "2026-07-01", name: "Grocer", amount: -40 },
        { date: "2026-08-01", name: "Grocer", amount: -210 },
        { date: "2026-09-01", name: "Grocer", amount: -95 },
      ]),
    ).toEqual([]);
  });
});

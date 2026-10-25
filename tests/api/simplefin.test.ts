import { describe, expect, it } from "vitest";
import { claimUrlFromSetupToken, simplefinAccountType, toFeedTransactions } from "@/lib/simplefin/client";

describe("SimpleFIN", () => {
  it("finds the claim URL in a setup token, and refuses anything else", () => {
    const token = Buffer.from("https://bridge.example/simplefin/claim/ABC").toString("base64");
    expect(claimUrlFromSetupToken(` ${token}\n`).href).toBe("https://bridge.example/simplefin/claim/ABC");
    expect(() => claimUrlFromSetupToken(Buffer.from("http://bridge.example/claim").toString("base64"))).toThrow(/setup token/);
    expect(() => claimUrlFromSetupToken("not a token")).toThrow(/setup token/);
  });

  it("guesses money owed from a negative balance or the account's name", () => {
    expect(simplefinAccountType({ name: "Everyday Checking", balance: "1200.00" })).toBe("asset");
    expect(simplefinAccountType({ name: "Rewards", balance: "-310.55" })).toBe("liability");
    expect(simplefinAccountType({ name: "Visa Signature", balance: "0.00" })).toBe("liability");
    expect(simplefinAccountType({ name: "Auto Loan", balance: "15000" })).toBe("liability");
  });

  it("turns posted transactions into feed rows with ids unique across accounts, leaving pending ones", () => {
    const rows = toFeedTransactions({
      id: "ACT-1",
      name: "Checking",
      currency: "USD",
      balance: "100",
      transactions: [
        { id: "T1", posted: Date.parse("2026-10-20T12:00:00Z") / 1000, amount: "-42.10", description: "POS 1234 GROCER", payee: "Grocer" },
        { id: "T2", posted: Date.parse("2026-10-21T00:00:00Z") / 1000, amount: "1500.00", description: "Payroll" },
        { id: "T3", posted: 0, amount: "-5.00", description: "Coffee", pending: true },
      ],
    }, "UTC");
    expect(rows).toEqual([
      // PlaidTransaction's sign: positive is money out.
      { id: "sfin:ACT-1:T1", account_id: "sfin:ACT-1", amount: 42.1, date: "2026-10-20", name: "Grocer" },
      { id: "sfin:ACT-1:T2", account_id: "sfin:ACT-1", amount: -1500, date: "2026-10-21", name: "Payroll" },
    ]);
  });

  it("dates a transaction on the book's day, not UTC's", () => {
    const [row] = toFeedTransactions(
      {
        id: "ACT-1",
        name: "Checking",
        currency: "USD",
        balance: "100",
        // 7 pm on the 20th in Chicago.
        transactions: [{ id: "T1", posted: Date.parse("2026-10-21T00:00:00Z") / 1000, amount: "-1.00", description: "Late" }],
      },
      "America/Chicago",
    );
    expect(row.date).toBe("2026-10-20");
  });
});

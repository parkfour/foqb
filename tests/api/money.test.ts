import { describe, expect, it } from "vitest";
import { formatMoney, isValidCurrency } from "@/lib/money";

describe("formatMoney", () => {
  it("formats in the book's currency, with that currency's decimals", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(1234.5, "EUR")).toBe("€1,234.50");
    expect(formatMoney(1500000, "KRW")).toBe("₩1,500,000");
    expect(formatMoney(-20, "USD")).toBe("-$20.00");
  });

  it("knows a currency code from anything else", () => {
    expect(isValidCurrency("KRW")).toBe(true);
    expect(isValidCurrency("krw")).toBe(false);
    expect(isValidCurrency("ZZZ")).toBe(false);
    expect(isValidCurrency("")).toBe(false);
  });
});

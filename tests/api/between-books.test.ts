import { describe, expect, it } from "vitest";
import { sideLines, validateBetweenBooks } from "@/lib/between-books";

const side = (orgId: string) => ({ orgId, debitAccountId: `${orgId}-d`, creditAccountId: `${orgId}-c` });

describe("between your books", () => {
  it("makes each side a balanced debit and credit", () => {
    expect(sideLines(side("h"), 42.5)).toEqual([
      { account_id: "h-d", debit: 42.5, credit: 0 },
      { account_id: "h-c", debit: 0, credit: 42.5 },
    ]);
  });

  it("asks for two books, two different accounts each, a date and an amount to the cent", () => {
    const ok = { kind: "paid_for", date: "2026-10-20", amount: 42.5, a: side("h"), b: side("b") };
    expect(validateBetweenBooks(ok)).toBeNull();
    expect(validateBetweenBooks({ ...ok, b: side("h") })).toMatch(/other book/);
    expect(validateBetweenBooks({ ...ok, amount: 19.99 })).toBeNull();
    expect(validateBetweenBooks({ ...ok, amount: 1.234 })).toMatch(/cent/);
    expect(validateBetweenBooks({ ...ok, amount: 0 })).toMatch(/above zero/);
    expect(validateBetweenBooks({ ...ok, kind: "gift" })).toMatch(/what happened/);
    expect(validateBetweenBooks({ ...ok, a: { ...side("h"), creditAccountId: "h-d" } })).toMatch(/differ/);
  });
});

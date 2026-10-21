import { describe, expect, it } from "vitest";
import { pairTransfers } from "@/lib/bank/transfers";

const row = (id: string, account_id: string | null, date: string, amount: number) => ({ id, account_id, date, amount });

describe("pairTransfers", () => {
  it("pairs money out of one account with the same amount into another within 5 days", () => {
    const out = row("a", "checking", "2026-10-10", -500);
    const into = row("b", "card", "2026-10-15", 500);
    const pairs = pairTransfers([out, into]);
    expect(pairs.get("a")).toBe(into);
    expect(pairs.get("b")).toBe(out);
  });

  it("ignores the same account, a different amount, or more than 5 days apart", () => {
    const pairs = pairTransfers([
      row("a", "checking", "2026-10-10", -500),
      row("b", "checking", "2026-10-10", 500),
      row("c", "card", "2026-10-11", 499.99),
      row("d", "savings", "2026-10-16", 500),
      row("e", null, "2026-10-10", 500),
    ]);
    expect(pairs.size).toBe(0);
  });

  it("prefers the nearest date and uses each row once", () => {
    const out1 = row("a", "checking", "2026-10-10", -100);
    const out2 = row("b", "checking", "2026-10-12", -100);
    const near = row("c", "card", "2026-10-12", 100);
    const far = row("d", "card", "2026-10-10", 100);
    const pairs = pairTransfers([out1, out2, near, far]);
    expect(pairs.get("b")).toBe(near);
    expect(pairs.get("a")).toBe(far);
  });
});

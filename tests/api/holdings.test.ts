import { describe, expect, it } from "vitest";
import { computeHoldings, type Trade } from "@/lib/investments/holdings";

const trade = (kind: "buy" | "sell", trade_date: string, quantity: number, price: number, fees = 0): Trade => ({
  account_id: "ira",
  security_id: "vti",
  trade_date,
  kind,
  quantity,
  price,
  fees,
});

describe("computeHoldings", () => {
  it("averages cost across buys and takes average cost out on a sale", () => {
    const [h] = computeHoldings([
      trade("buy", "2026-01-02", 10, 200, 5),
      trade("buy", "2026-02-02", 10, 220),
      trade("sell", "2026-03-02", 5, 250, 1),
    ]);
    // Cost 2,005 + 2,200 = 4,205 for 20; selling 5 takes out a quarter.
    expect(h.quantity).toBe(15);
    expect(h.cost).toBe(3153.75);
    expect(h.realized).toBe(1249 - 1051.25);
  });

  it("orders trades by date whatever order they come in", () => {
    const [h] = computeHoldings([trade("sell", "2026-03-02", 10, 10), trade("buy", "2026-01-02", 10, 5)]);
    expect(h).toMatchObject({ quantity: 0, cost: 0, realized: 50 });
  });
});

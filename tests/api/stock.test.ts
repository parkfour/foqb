import { describe, expect, it } from "vitest";
import { averageCost, saleCostLines, type StockItem } from "@/lib/ar/stock";

const widget: StockItem = { id: "w", inventory_account_id: "inv", cogs_account_id: "cogs", unit_cost: 2.5 };

describe("saleCostLines", () => {
  it("moves a stock item's average cost to cost of goods sold and takes it off the count", () => {
    const sale = saleCostLines(
      [
        { item_id: "w", quantity: 3 },
        { item_id: "service", quantity: 1 },
        { item_id: null, quantity: 1 },
      ],
      new Map([["w", widget]]),
    );
    expect(sale.journalLines).toEqual([
      { account_id: "cogs", debit: 7.5, credit: 0 },
      { account_id: "inv", debit: 0, credit: 7.5 },
    ]);
    expect(sale.moves).toEqual([{ item_id: "w", quantity: -3, unit_cost: 2.5 }]);
  });

  it("still counts an item with no cost yet, without a zero entry line", () => {
    const sale = saleCostLines([{ item_id: "w", quantity: 1 }], new Map([["w", { ...widget, unit_cost: 0 }]]));
    expect(sale.journalLines).toEqual([]);
    expect(sale.moves).toHaveLength(1);
  });
});

describe("averageCost", () => {
  it("weights what's on hand with what was bought", () => {
    expect(averageCost(10, 2, 10, 4)).toBe(3);
  });

  it("starts from the price when nothing (or less than nothing) is on hand", () => {
    expect(averageCost(0, 9, 5, 4)).toBe(4);
    expect(averageCost(-3, 9, 5, 4)).toBe(4);
  });
});

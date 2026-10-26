import { describe, expect, it } from "vitest";
import { pivotByClass, type ByClassRow } from "@/lib/reports/by-class";

const row = (account_id: string, type: "revenue" | "expense", class_id: string | null, amount: number): ByClassRow => ({
  account_id,
  account_number: account_id,
  name: account_id,
  type,
  class_id,
  amount,
});

describe("pivotByClass", () => {
  it("puts each account's amounts in its classes' columns, unclassified last, unused classes left out", () => {
    const table = pivotByClass(
      [row("sales", "revenue", "east", 100), row("sales", "revenue", null, 5), row("rent", "expense", "west", 40)],
      [
        { id: "east", name: "East" },
        { id: "north", name: "North" },
        { id: "west", name: "West" },
      ],
    );
    expect(table.columns).toEqual([
      { key: "east", name: "East" },
      { key: "west", name: "West" },
      { key: "", name: "Unclassified" },
    ]);
    expect(table.rows.map((r) => [r.account_id, r.amounts])).toEqual([
      ["sales", { east: 100, "": 5 }],
      ["rent", { west: 40 }],
    ]);
  });
});

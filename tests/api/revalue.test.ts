import { describe, expect, it } from "vitest";
import { revaluationLines } from "@/lib/fx/revalue";

describe("revaluationLines", () => {
  it("books a stronger currency as a gain on an asset", () => {
    expect(revaluationLines({ account_id: "eur", type: "asset", foreign_balance: 1000, book_balance: 1100 }, 1.15, "fx")).toEqual([
      { account_id: "eur", debit: 50, credit: 0, foreign_amount: 0 },
      { account_id: "fx", debit: 0, credit: 50 },
    ]);
  });

  it("books a stronger currency as a loss on a liability", () => {
    expect(revaluationLines({ account_id: "loan", type: "liability", foreign_balance: 1000, book_balance: 1100 }, 1.15, "fx")).toEqual([
      { account_id: "loan", debit: 0, credit: 50, foreign_amount: 0 },
      { account_id: "fx", debit: 50, credit: 0 },
    ]);
  });

  it("books nothing when the value hasn't changed", () => {
    expect(revaluationLines({ account_id: "eur", type: "asset", foreign_balance: 1000, book_balance: 1100 }, 1.1, "fx")).toBeNull();
  });
});

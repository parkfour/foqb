import { describe, expect, it } from "vitest";
import { buildCashFlowStatement, sectionOf } from "@/lib/reports/cash-flow";
import type { TrialBalanceRow } from "@/lib/reports";

const tb = (id: string, name: string, type: TrialBalanceRow["type"], debit: number, credit: number, account_number = "1500"): TrialBalanceRow => ({
  account_id: id,
  account_number,
  name,
  type,
  total_debit: debit,
  total_credit: credit,
  balance: 0,
});

const hints = { bankFed: new Set(["bank"]), fixedAssetAccounts: new Set(["truck"]) };

describe("sectionOf", () => {
  it("files accounts by name, bank feed and fixed asset", () => {
    expect(sectionOf(tb("bank", "Chase ••1234", "asset", 0, 0), hints)).toBe("cash");
    expect(sectionOf(tb("x", "Operating Checking", "asset", 0, 0), hints)).toBe("cash");
    expect(sectionOf(tb("truck", "Truck", "asset", 0, 0), hints)).toBe("investing");
    expect(sectionOf(tb("x", "Office Equipment", "asset", 0, 0), hints)).toBe("investing");
    expect(sectionOf(tb("x", "Accumulated Depreciation - Equipment", "asset", 0, 0), hints)).toBe("operating");
    expect(sectionOf(tb("x", "Accounts Receivable", "asset", 0, 0, "1200"), hints)).toBe("operating");
    expect(sectionOf(tb("x", "Accounts Payable", "liability", 0, 0), hints)).toBe("operating");
    expect(sectionOf(tb("x", "SBA Loan", "liability", 0, 0), hints)).toBe("financing");
    expect(sectionOf(tb("x", "Owner's Draw", "equity", 0, 0), hints)).toBe("financing");
    expect(sectionOf(tb("x", "Sales", "revenue", 0, 0), hints)).toBeNull();
  });
});

describe("buildCashFlowStatement", () => {
  it("explains the change in cash with net income and balance sheet changes", () => {
    const before = [
      tb("bank", "Chase", "asset", 1000, 0),
      tb("ar", "Accounts Receivable", "asset", 200, 0),
      tb("equity", "Owner's Contribution", "equity", 0, 1200),
    ];
    // In the period: $500 sales ($300 collected, $200 more owed), $100 rent,
    // a $2,000 truck on a $1,500 loan, a $50 depreciation entry, $100 owner's draw.
    const after = [
      tb("bank", "Chase", "asset", 1000 + 300 + 1500, 100 + 2000 + 100),
      tb("ar", "Accounts Receivable", "asset", 400, 0),
      tb("truck", "Truck", "asset", 2000, 0),
      tb("accum", "Accumulated Depreciation", "asset", 0, 50),
      tb("loan", "Truck Loan", "liability", 0, 1500),
      tb("equity", "Owner's Contribution", "equity", 100, 1200),
      tb("sales", "Sales", "revenue", 0, 500),
      tb("rent", "Rent", "expense", 100, 0),
      tb("dep", "Depreciation Expense", "expense", 50, 0),
    ];

    const s = buildCashFlowStatement(before, after, hints);

    expect(s.netIncome).toBe(350);
    expect(s.operating).toEqual([
      expect.objectContaining({ account_id: "ar", amount: -200 }),
      expect.objectContaining({ account_id: "accum", amount: 50 }),
    ]);
    expect(s.investing).toEqual([expect.objectContaining({ account_id: "truck", amount: -2000 })]);
    expect(s.financing).toEqual([
      expect.objectContaining({ account_id: "loan", amount: 1500 }),
      expect.objectContaining({ account_id: "equity", amount: -100 }),
    ]);
    expect(s.cashAtStart).toBe(1000);
    expect(s.cashAtEnd).toBe(600);
    expect(s.difference).toBe(0);
  });

  it("counts an account that first appears in the period from zero", () => {
    const s = buildCashFlowStatement([], [tb("bank", "Chase", "asset", 10, 0), tb("sales", "Sales", "revenue", 0, 10)], hints);
    expect(s.cashAtStart).toBe(0);
    expect(s.cashAtEnd).toBe(10);
    expect(s.netIncome).toBe(10);
    expect(s.difference).toBe(0);
  });
});

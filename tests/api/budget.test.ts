import { describe, it, expect } from "vitest";
import { calculateBudgetSummary, type BudgetCategoryInput } from "@/lib/budget/engine";

describe("Budget Engine", () => {
  it("calculates budget totals and percentages correctly", () => {
    const items: BudgetCategoryInput[] = [
      {
        accountId: "acc-1",
        accountNumber: "5100",
        accountName: "Groceries",
        budgetedAmount: 500,
        actualSpent: 250,
      },
      {
        accountId: "acc-2",
        accountNumber: "5200",
        accountName: "Dining Out",
        budgetedAmount: 300,
        actualSpent: 270,
      },
      {
        accountId: "acc-3",
        accountNumber: "5300",
        accountName: "Utilities",
        budgetedAmount: 200,
        actualSpent: 250,
      },
    ];

    const report = calculateBudgetSummary("org-1", "2026-10", items);

    expect(report.organizationId).toBe("org-1");
    expect(report.yearMonth).toBe("2026-10");
    expect(report.totalBudgeted).toBe(1000);
    expect(report.totalSpent).toBe(770);
    expect(report.totalRemaining).toBe(230);
    expect(report.overallPercentage).toBe(77);

    // Groceries: 250 / 500 = 50% -> on_track
    const groceries = report.categories.find((c) => c.accountNumber === "5100");
    expect(groceries?.remainingAmount).toBe(250);
    expect(groceries?.percentageUsed).toBe(50);
    expect(groceries?.status).toBe("on_track");

    // Dining: 270 / 300 = 90% -> caution
    const dining = report.categories.find((c) => c.accountNumber === "5200");
    expect(dining?.remainingAmount).toBe(30);
    expect(dining?.percentageUsed).toBe(90);
    expect(dining?.status).toBe("caution");

    // Utilities: 250 / 200 = 125% -> over_budget
    const utilities = report.categories.find((c) => c.accountNumber === "5300");
    expect(utilities?.remainingAmount).toBe(-50);
    expect(utilities?.percentageUsed).toBe(125);
    expect(utilities?.status).toBe("over_budget");
  });

  it("handles zero budgeted amount when actual spending occurs", () => {
    const items: BudgetCategoryInput[] = [
      {
        accountId: "acc-1",
        accountNumber: "5999",
        accountName: "Unbudgeted Expenses",
        budgetedAmount: 0,
        actualSpent: 120,
      },
    ];

    const report = calculateBudgetSummary("org-1", "2026-10", items);
    expect(report.totalBudgeted).toBe(0);
    expect(report.totalSpent).toBe(120);
    expect(report.totalRemaining).toBe(-120);
    expect(report.overallPercentage).toBe(100);

    const cat = report.categories[0];
    expect(cat.remainingAmount).toBe(-120);
    expect(cat.percentageUsed).toBe(100);
    expect(cat.status).toBe("over_budget"); // any spending against $0 is over
  });

  it("treats spending exactly the budget as at the limit, not over", () => {
    const report = calculateBudgetSummary("org-1", "2026-10", [
      { accountId: "acc-1", accountNumber: "5100", accountName: "Rent", budgetedAmount: 1500, actualSpent: 1500 },
    ]);
    expect(report.categories[0].status).toBe("caution");
  });

  it("handles zero spending on a budgeted category", () => {
    const items: BudgetCategoryInput[] = [
      {
        accountId: "acc-1",
        accountNumber: "5100",
        accountName: "Travel",
        budgetedAmount: 1000,
        actualSpent: 0,
      },
    ];

    const report = calculateBudgetSummary("org-1", "2026-10", items);
    expect(report.totalBudgeted).toBe(1000);
    expect(report.totalSpent).toBe(0);
    expect(report.totalRemaining).toBe(1000);
    expect(report.overallPercentage).toBe(0);

    const cat = report.categories[0];
    expect(cat.remainingAmount).toBe(1000);
    expect(cat.percentageUsed).toBe(0);
    expect(cat.status).toBe("on_track");
  });

  it("sorts categories by account number ascending", () => {
    const items: BudgetCategoryInput[] = [
      { accountId: "acc-3", accountNumber: "5800", accountName: "Z", budgetedAmount: 10, actualSpent: 0 },
      { accountId: "acc-1", accountNumber: "5100", accountName: "A", budgetedAmount: 10, actualSpent: 0 },
      { accountId: "acc-2", accountNumber: "5500", accountName: "M", budgetedAmount: 10, actualSpent: 0 },
    ];

    const report = calculateBudgetSummary("org-1", "2026-10", items);
    expect(report.categories.map((c) => c.accountNumber)).toEqual(["5100", "5500", "5800"]);
  });
});

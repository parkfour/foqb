import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BudgetManager } from "@/components/budget/budget-manager";
import type { MonthlyBudgetReport } from "@/lib/budget/engine";

afterEach(() => {
  cleanup();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@/app/(dashboard)/budget/actions", () => ({
  updateBudgetCategoryAction: vi.fn(),
  copyPreviousMonthAction: vi.fn(),
}));

describe("BudgetManager Component", () => {
  const sampleReport: MonthlyBudgetReport = {
    organizationId: "org-1",
    yearMonth: "2026-10",
    totalBudgeted: 3000,
    totalSpent: 1800,
    totalRemaining: 1200,
    overallPercentage: 60,
    categories: [
      {
        accountId: "acc-1",
        accountNumber: "5110",
        accountName: "Groceries & Provisions",
        budgetedAmount: 800,
        actualSpent: 400,
        remainingAmount: 400,
        percentageUsed: 50,
        status: "on_track",
        notes: null,
      },
      {
        accountId: "acc-2",
        accountNumber: "5210",
        accountName: "Restaurants & Dining",
        budgetedAmount: 500,
        actualSpent: 600,
        remainingAmount: -100,
        percentageUsed: 120,
        status: "over_budget",
        notes: null,
      },
    ],
  };

  it("renders summary cards with correct amounts", () => {
    render(<BudgetManager report={sampleReport} canWrite={true} />);

    expect(screen.getByText("Household Budget")).toBeInTheDocument();
    expect(screen.getByText("$3,000.00")).toBeInTheDocument();
    expect(screen.getByText("$1,800.00")).toBeInTheDocument();
    expect(screen.getByText("$1,200.00")).toBeInTheDocument();
    expect(screen.getByText("60% Used")).toBeInTheDocument();
  });

  it("renders categories with status badges", () => {
    render(<BudgetManager report={sampleReport} canWrite={true} />);

    expect(screen.getByText("Groceries & Provisions")).toBeInTheDocument();
    expect(screen.getByText("Restaurants & Dining")).toBeInTheDocument();

    expect(screen.getByText(/On track/)).toBeInTheDocument();
    expect(screen.getByText(/Over by \$100\.00/)).toBeInTheDocument();
  });
});

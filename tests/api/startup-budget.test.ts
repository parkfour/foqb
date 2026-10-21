import { describe, expect, it } from "vitest";
import { averageSpending, budgetTimeframe, monthsBetween } from "@/plugins/startup-assistant/budget";

describe("startup budget", () => {
  it("covers the whole months from after the earliest opening to the last finished month", () => {
    expect(budgetTimeframe(["2025-12-31", "2026-02-14"], "2026-10-20")).toEqual({ from: "2026-01", to: "2026-09" });
    // A mid-month opening: its month is partial, so it starts the month after.
    expect(budgetTimeframe(["2025-11-14"], "2026-01-05")).toEqual({ from: "2025-12", to: "2025-12" });
  });

  it("has no timeframe before a whole month is in, or without openings", () => {
    expect(budgetTimeframe(["2026-09-30"], "2026-10-20")).toBeNull();
    expect(budgetTimeframe([], "2026-10-20")).toBeNull();
  });

  it("keeps the timeframe to the most recent 36 months", () => {
    expect(budgetTimeframe(["2020-12-31"], "2026-10-20")).toEqual({ from: "2023-10", to: "2026-09" });
  });

  it("lists every month in between, across New Year, and refuses a backwards or overlong range", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(() => monthsBetween("2026-03", "2026-01")).toThrow(/before the first/);
    expect(() => monthsBetween("2020-01", "2026-01")).toThrow(/At most 36/);
    expect(() => monthsBetween("2026-13", "2026-14")).toThrow(/Not a month/);
  });

  it("averages each expense account to whole dollars, skipping revenue and net refunds", () => {
    expect(
      averageSpending(
        [
          { account_id: "groceries", type: "expense", amount: "5400.00" },
          { account_id: "utilities", type: "expense", amount: 1000 },
          { account_id: "refunded", type: "expense", amount: -40 },
          { account_id: "salary", type: "revenue", amount: 90000 },
        ],
        9,
      ),
    ).toEqual([
      { accountId: "groceries", monthly: 600 },
      { accountId: "utilities", monthly: 111 },
    ]);
  });
});

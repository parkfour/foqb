import { describe, expect, it } from "vitest";
import { advanceOneMonth, monthlyDepreciationAmount } from "@/lib/fixed-assets/depreciate";

describe("monthlyDepreciationAmount", () => {
  it("splits (cost - salvage) evenly across the useful life", () => {
    expect(
      monthlyDepreciationAmount({ cost: 6000, salvage_value: 600, useful_life_months: 60 }),
    ).toBe(90);
  });

  it("rounds to the nearest cent", () => {
    expect(
      monthlyDepreciationAmount({ cost: 1000, salvage_value: 0, useful_life_months: 3 }),
    ).toBe(333.33);
  });
});

describe("advanceOneMonth", () => {
  it("advances a normal date by one month", () => {
    expect(advanceOneMonth("2026-06-15")).toBe("2026-07-15");
  });

  it("rolls over the year boundary", () => {
    expect(advanceOneMonth("2026-12-15")).toBe("2027-01-15");
  });
});

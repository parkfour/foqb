import { describe, expect, it } from "vitest";
import { mileageAmount, standardMileageRate } from "@/lib/mileage/rates";

describe("standardMileageRate", () => {
  it("uses the rate in effect on the trip's date, including a mid-year change", () => {
    expect(standardMileageRate("2025-12-31")).toBe(0.7);
    expect(standardMileageRate("2026-01-01")).toBe(0.725);
    expect(standardMileageRate("2026-06-30")).toBe(0.725);
    expect(standardMileageRate("2026-07-01")).toBe(0.76);
  });

  it("rounds a trip's amount to the cent", () => {
    expect(mileageAmount(12.3, 0.725)).toBe(8.92);
  });
});

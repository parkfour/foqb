import { describe, expect, it } from "vitest";
import { computeBookEquity } from "@/lib/org/equity-rollup";
import { computeNetWorth } from "@/lib/net-worth/engine";

describe("Cross-Entity Business Equity & Net Worth Calculations", () => {
  describe("computeBookEquity", () => {
    it("computes Book Equity as Assets minus Liabilities", () => {
      const assets = 350000;
      const liabilities = 120000;
      const equity = computeBookEquity(assets, liabilities);

      expect(equity).toBe(230000);
    });

    it("handles zero assets or liabilities accurately", () => {
      expect(computeBookEquity(100000, 0)).toBe(100000);
      expect(computeBookEquity(0, 50000)).toBe(-50000);
    });
  });

  describe("computeNetWorth", () => {
    it("calculates Net Worth as Total Assets minus Total Liabilities", () => {
      const totalAssets = 1250000;
      const totalLiabilities = 450000;

      const netWorth = computeNetWorth(totalAssets, totalLiabilities);
      expect(netWorth).toBe(800000);
    });

    it("consolidates business equity into total assets correctly", () => {
      const personalAssets = 750000;
      const businessBookEquity = 250000;
      const liabilities = 300000;

      const totalConsolidatedAssets = personalAssets + businessBookEquity;
      const consolidatedNetWorth = computeNetWorth(totalConsolidatedAssets, liabilities);

      expect(consolidatedNetWorth).toBe(700000);
    });
  });
});

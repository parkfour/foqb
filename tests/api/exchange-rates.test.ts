// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeRate } from "@/lib/plugins/server-loader";
import { clearRateCache, fetchRate } from "@/plugins/exchange-rates/server";
import { calculateUserBusinessEquity, suspendedBeforeClose } from "@/lib/org/equity-rollup";
import type { ExchangeRate, ServerPluginParts } from "@/lib/plugins/types";

const quote = (rate: number, asOf = "2026-10-23"): ExchangeRate => ({ rate, asOf, source: "Test" });
const now = new Date("2026-10-25T12:00:00Z");
const source = (rate: ServerPluginParts["exchangeRates"]): Record<string, ServerPluginParts> => ({ fx: { exchangeRates: rate } });

describe("exchangeRate", () => {
  it("uses an enabled plugin's quote", async () => {
    const parts = source({ rate: async () => quote(0.00075) });
    expect(await exchangeRate("KRW", "USD", ["fx"], parts, now)).toEqual(quote(0.00075));
    expect(await exchangeRate("KRW", "USD", [], parts, now)).toBeNull();
  });

  it("refuses a stale, zero or failing quote rather than guess", async () => {
    expect(await exchangeRate("KRW", "USD", ["fx"], source({ rate: async () => quote(0.00075, "2026-10-01") }), now)).toBeNull();
    expect(await exchangeRate("KRW", "USD", ["fx"], source({ rate: async () => quote(0) }), now)).toBeNull();
    const failing = source({ rate: async () => { throw new Error("down"); } });
    expect(await exchangeRate("KRW", "USD", ["fx"], failing, now)).toBeNull();
  });
});

describe("fetchRate", () => {
  afterEach(clearRateCache);
  const reply = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: async () => body });

  it("reads Frankfurter's reply, and asks once while it's fresh", async () => {
    const fetcher = reply({ amount: 1, base: "KRW", date: "2026-10-23", rates: { USD: 0.00075503 } });
    expect(await fetchRate("KRW", "USD", fetcher)).toEqual({
      rate: 0.00075503,
      asOf: "2026-10-23",
      source: "European Central Bank reference rate",
    });
    await fetchRate("KRW", "USD", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.frankfurter.dev/v1/latest?base=KRW&symbols=USD");
  });

  it("gives no quote for an unknown currency, a bad reply or a bad code", async () => {
    expect(await fetchRate("XYZ", "USD", reply({ message: "not found" }, false))).toBeNull();
    expect(await fetchRate("EUR", "USD", reply({ date: "soon", rates: { USD: 1.1 } }))).toBeNull();
    const fetcher = vi.fn();
    expect(await fetchRate("krw&x=1", "USD", fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("calculateUserBusinessEquity", () => {
  const orgs = [
    { id: "us", name: "Park Four", currency: "USD" },
    { id: "kr", name: "Seoul Co", currency: "KRW" },
    { id: "eu", name: "Berlin GmbH", currency: "EUR" },
  ];
  const equity: Record<string, number> = { us: 1000, kr: 2_000_000, eu: 500 };
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({
            data: orgs.map((o) => ({ organization_id: o.id, role: "owner", organizations: { ...o, workspace_type: "business" } })),
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (_: string, { p_org_id }: { p_org_id: string }) => ({
      data: [{ account_id: "a", type: "asset", balance: equity[p_org_id] }],
    }),
  };

  it("adds its own currency as is, another at its quote, and leaves out one with no quote", async () => {
    const rateFor = async (from: string) => (from === "KRW" ? quote(0.00075) : null);
    const { businesses, totalBusinessEquity } = await calculateUserBusinessEquity("u1", supabase as never, "USD", rateFor);

    expect(businesses.map((b) => [b.organizationName, b.bookEquity, b.counted])).toEqual([
      ["Park Four", 1000, 1000],
      ["Seoul Co", 2_000_000, 1500],
      ["Berlin GmbH", 500, null],
    ]);
    expect(businesses[1].quote).toEqual(quote(0.00075));
    expect(totalBusinessEquity).toBe(2500);
  });
});

describe("suspendedBeforeClose", () => {
  it("is true only when the business was suspended before the day its books were closed through", () => {
    expect(suspendedBeforeClose("2025-06-01T12:00:00Z", "2025-12-31", "UTC")).toBe(true);
    expect(suspendedBeforeClose("2026-01-15T12:00:00Z", "2025-12-31", "UTC")).toBe(false);
    // Early on Jan 1 in UTC is still Dec 31 in Chicago, the close day itself: not before it.
    expect(suspendedBeforeClose("2026-01-01T03:00:00Z", "2025-12-31", "America/Chicago")).toBe(false);
    expect(suspendedBeforeClose("2025-12-30T23:00:00Z", "2025-12-31", "America/Chicago")).toBe(true);
    expect(suspendedBeforeClose(null, "2025-12-31", "UTC")).toBe(false);
    expect(suspendedBeforeClose("2025-06-01T12:00:00Z", null, "UTC")).toBe(false);
  });

  it("leaves a business suspended before its close out of the roll-up altogether", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => ({
              data: [
                {
                  organization_id: "old",
                  role: "owner",
                  organizations: { id: "old", name: "Old Co", workspace_type: "business", currency: "USD", status: "suspended", suspended_at: "2025-06-01T12:00:00Z", period_lock_date: "2025-12-31" },
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
      rpc: async () => ({ data: [] }),
    };
    const { businesses } = await calculateUserBusinessEquity("u1", supabase as never, "USD", async () => null);
    expect(businesses).toEqual([]);
  });
});

// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ExchangeRate, ServerPluginParts } from "@/lib/plugins/types";

// Frankfurter serves the European Central Bank's daily reference rates, with
// no key. Only the two currency codes are sent.
const API = "https://api.frankfurter.dev/v1/latest";
const SOURCE = "European Central Bank reference rate";
const CACHE_MS = 6 * 60 * 60 * 1000;
// A failed lookup is retried after this, not on every page view.
const MISS_CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;

// ponytail: per-process cache; each app instance asks for itself.
const cache = new Map<string, { until: number; quote: ExchangeRate | null }>();

export async function fetchRate(from: string, to: string, fetcher: typeof fetch = fetch): Promise<ExchangeRate | null> {
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  const key = `${from}:${to}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.quote;

  let quote: ExchangeRate | null = null;
  try {
    const res = await fetcher(`${API}?base=${from}&symbols=${to}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      const body = (await res.json()) as { date?: unknown; rates?: Record<string, unknown> };
      const rate = Number(body.rates?.[to]);
      if (Number.isFinite(rate) && rate > 0 && typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        quote = { rate, asOf: body.date, source: SOURCE };
      }
    }
  } catch {
    // Offline or slow: no quote.
  }
  cache.set(key, { until: Date.now() + (quote ? CACHE_MS : MISS_CACHE_MS), quote });
  return quote;
}

// For tests.
export function clearRateCache(): void {
  cache.clear();
}

export const exchangeRatesServer: ServerPluginParts = {
  exchangeRates: { rate: (from, to) => fetchRate(from, to) },
};

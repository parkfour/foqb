// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SecurityPrice, ServerPluginParts } from "@/lib/plugins/types";

// Stooq's quote CSV, no key: "Symbol,Date,Time,Open,High,Low,Close,Volume".
// A US symbol is asked for as SYMBOL.US; one with its own market suffix
// (VOD.UK) as written.
const API = "https://stooq.com/q/l/";
const SOURCE = "Stooq daily close";
const TIMEOUT_MS = 5000;

export function stooqSymbol(symbol: string): string {
  return (symbol.includes(".") ? symbol : `${symbol}.US`).toLowerCase();
}

export function parseStooq(csv: string): SecurityPrice | null {
  const [header, row] = csv.trim().split(/\r?\n/);
  if (!header || !row) return null;
  const cols = header.split(",");
  const values = row.split(",");
  const date = values[cols.indexOf("Date")];
  const close = Number(values[cols.indexOf("Close")]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isFinite(close) || close <= 0) return null;
  return { price: close, asOf: date, source: SOURCE };
}

export async function fetchPrice(symbol: string, fetcher: typeof fetch = fetch): Promise<SecurityPrice | null> {
  if (!/^[A-Z0-9.^-]{1,20}$/.test(symbol)) return null;
  try {
    const res = await fetcher(`${API}?s=${encodeURIComponent(stooqSymbol(symbol))}&f=sd2t2ohlcv&h&e=csv`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? parseStooq(await res.text()) : null;
  } catch {
    return null;
  }
}

export const securityPricesServer: ServerPluginParts = {
  securityPrices: { price: (symbol) => fetchPrice(symbol) },
};

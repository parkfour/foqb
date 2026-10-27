// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// RentCast's value estimate (an AVM from nearby sales), with a key the book
// gets from rentcast.io. The free plan has 50 lookups a month and charges
// for each past that, so the caller counts them.
const API = "https://api.rentcast.io/v1/avm/value";
const TIMEOUT_MS = 15_000;

export const RENTCAST_KEY = /^[A-Za-z0-9_-]{16,128}$/;

export interface RentcastEstimate {
  value: number;
  low: number | null;
  high: number | null;
}

// RentCast wants "Street, City, State, Zip".
export function rentcastAddress(p: {
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}): string | null {
  const parts = [p.address_street, p.address_city, p.address_state, p.address_zip].map((s) => s?.trim());
  return parts.every(Boolean) ? parts.join(", ") : null;
}

const positive = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);

export async function lookupRentcast(address: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<RentcastEstimate | null> {
  try {
    const res = await fetcher(`${API}?${new URLSearchParams({ address })}`, {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { price?: unknown; priceRangeLow?: unknown; priceRangeHigh?: unknown };
    const value = positive(body.price);
    return value === null ? null : { value, low: positive(body.priceRangeLow), high: positive(body.priceRangeHigh) };
  } catch {
    return null;
  }
}

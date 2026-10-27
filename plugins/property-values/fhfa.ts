// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A value from FHFA's all-transactions house price index, through FRED:
// what was paid × (latest quarter's index ÷ the purchase quarter's). The
// index is the property's metro division, else its metro area, else its
// state, else the US; the Census Bureau's geocoder (free, no key) says
// which ones an address is in.
const GEOCODER = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const FRED = "https://api.stlouisfed.org/fred/series/observations";
const TIMEOUT_MS = 10_000;

export interface Geo {
  division?: { code: string; name: string };
  metro?: { code: string; name: string };
  state?: string;
}

export interface IndexValue {
  value: number;
  series: string;
  index: string; // which index, as shown: "Chicago-Naperville-Schaumburg, IL Metro Division"
  from: string; // the purchase quarter's first day, as FRED dates it
  to: string; // the latest published quarter's
  fromIndex: number;
  toIndex: number;
}

export type Observation = { date: string; value: number };
export type SeriesCache = Map<string, Promise<Observation[] | null>>;

const STATE = /^[A-Z]{2}$/;
export const FRED_KEY = /^[a-z0-9]{32}$/;

// The first day of the quarter a date falls in, as FRED dates its quarters.
export function quarterOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
}

export function quarterLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}

// The two-letter state at the end of a typed address ("…, Omaha, NE 68136").
export function stateIn(address: string): string | undefined {
  return address.toUpperCase().match(/\b([A-Z]{2})\s*\d{5}(?:-\d{4})?\s*$/)?.[1];
}

export async function geocode(address: string, fetcher: typeof fetch = fetch): Promise<Geo> {
  const fallback: Geo = { state: stateIn(address) };
  try {
    const params = new URLSearchParams({
      address,
      benchmark: "Public_AR_Current",
      vintage: "Current_Current",
      layers: "all",
      format: "json",
    });
    const res = await fetcher(`${GEOCODER}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return fallback;
    const body = (await res.json()) as {
      result?: { addressMatches?: { geographies?: Record<string, Record<string, string>[]>; addressComponents?: { state?: string } }[] };
    };
    const match = body.result?.addressMatches?.[0];
    if (!match) return fallback;
    const g = match.geographies ?? {};
    const div = g["Metropolitan Divisions"]?.[0];
    const msa = g["Metropolitan Statistical Areas"]?.[0];
    const state = g["States"]?.[0]?.STUSAB ?? match.addressComponents?.state ?? fallback.state;
    return {
      ...(div?.METDIV ? { division: { code: div.METDIV, name: div.NAME } } : {}),
      ...(msa?.CBSA ? { metro: { code: msa.CBSA, name: msa.NAME } } : {}),
      ...(state && STATE.test(state) ? { state } : {}),
    };
  } catch {
    return fallback;
  }
}

// FRED's series ids for each index, most local first.
export function candidates(geo: Geo): { series: string; index: string }[] {
  return [
    ...(geo.division ? [{ series: `ATNHPIUS${geo.division.code}Q`, index: geo.division.name }] : []),
    ...(geo.metro ? [{ series: `ATNHPIUS${geo.metro.code}Q`, index: geo.metro.name }] : []),
    ...(geo.state ? [{ series: `${geo.state}STHPI`, index: `${geo.state} statewide` }] : []),
    { series: "USSTHPI", index: "United States" },
  ];
}

// A series' quarters, or null when FRED has no such series (a metro area
// FHFA splits into divisions) or can't be reached.
export async function fetchSeries(series: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<Observation[] | null> {
  try {
    const params = new URLSearchParams({ series_id: series, api_key: apiKey, file_type: "json" });
    const res = await fetcher(`${FRED}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { observations?: { date: string; value: string }[] };
    return (body.observations ?? [])
      .map((o) => ({ date: o.date, value: Number(o.value) }))
      .filter((o) => Number.isFinite(o.value) && o.value > 0);
  } catch {
    return null;
  }
}

export function indexValue(base: number, baseDate: string, observations: Observation[]): Omit<IndexValue, "series" | "index"> | null {
  const from = observations.find((o) => o.date === quarterOf(baseDate));
  const to = observations.at(-1);
  // Bought in a quarter FHFA hasn't published yet, or before the series starts.
  if (!from || !to || to.date < from.date) return null;
  return {
    value: Math.round(((base * to.value) / from.value) * 100) / 100,
    from: from.date,
    to: to.date,
    fromIndex: from.value,
    toIndex: to.value,
  };
}

// The most local index that covers the purchase quarter.
export async function valueByIndex(
  base: number,
  baseDate: string,
  geo: Geo,
  apiKey: string,
  cache: SeriesCache,
  fetcher: typeof fetch = fetch,
): Promise<IndexValue | null> {
  for (const c of candidates(geo)) {
    if (!cache.has(c.series)) cache.set(c.series, fetchSeries(c.series, apiKey, fetcher));
    const observations = await cache.get(c.series)!;
    const v = observations && indexValue(base, baseDate, observations);
    if (v) return { ...v, ...c };
  }
  return null;
}

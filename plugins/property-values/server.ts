// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerPluginParts } from "@/lib/plugins/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgEnabledPluginIds, getPluginSettings } from "@/lib/plugins/settings";
import { getPluginData, setPluginData } from "@/lib/plugins/data";
import { decryptToken } from "@/lib/crypto/token-encryption";
import { geocode, stateIn, valueByIndex, type Geo, type IndexValue, type SeriesCache } from "./fhfa";
import { lookupRentcast, rentcastAddress } from "./rentcast";

// Zillow has no public API; unofficial ones are sold through RapidAPI and
// others, each shaped a little differently. The instance names its own:
//   PROPERTY_VALUE_API_URL   a URL with {address} in it, e.g.
//                            https://zillow-com1.p.rapidapi.com/property?address={address}
//   PROPERTY_VALUE_API_KEY   sent as X-RapidAPI-Key
//   PROPERTY_VALUE_API_HOST  sent as X-RapidAPI-Host (optional)
// The value is the first "zestimate" number anywhere in the reply.
const TIMEOUT_MS = 10_000;
// Free tiers allow about 100 lookups a month.
const MAX_PER_RUN = 20;
export const PROPERTY_VALUE_INTERVAL_SECONDS = 7 * 24 * 60 * 60;

export function findZestimate(body: unknown, depth = 0): number | null {
  if (depth > 6 || body === null || typeof body !== "object") return null;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key.toLowerCase() === "zestimate") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  for (const value of Object.values(body as Record<string, unknown>)) {
    const n = findZestimate(value, depth + 1);
    if (n !== null) return n;
  }
  return null;
}

export function addressOf(p: { address_street: string | null; address_city: string | null; address_state: string | null; address_zip: string | null }): string | null {
  if (!p.address_street || !(p.address_zip || (p.address_city && p.address_state))) return null;
  return [p.address_street, p.address_city, [p.address_state, p.address_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export async function lookupValue(
  address: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  const template = env.PROPERTY_VALUE_API_URL;
  const key = env.PROPERTY_VALUE_API_KEY;
  if (!template?.startsWith("https://") || !template.includes("{address}") || !key) return null;
  try {
    const res = await fetcher(template.replace("{address}", encodeURIComponent(address)), {
      headers: { "X-RapidAPI-Key": key, ...(env.PROPERTY_VALUE_API_HOST ? { "X-RapidAPI-Host": env.PROPERTY_VALUE_API_HOST } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? findZestimate(await res.json()) : null;
  } catch {
    return null;
  }
}

export const PLUGIN_ID = "property-values";
// plugin_data keys. API keys are encrypted (ENCRYPTION_KEY): members can
// read plugin_data.
export const API_KEYS = { fred: "fred-key", rentcast: "rentcast-key" } as const;
export type ApiKeyName = keyof typeof API_KEYS;
export const VALUATIONS_KEY = "valuations";
export const NOTE_BASES_KEY = "note-bases";

export type ValueSource = "fhfa" | "rentcast" | "zillow";
export const valueSource = (s: unknown): ValueSource => (s === "rentcast" || s === "zillow" ? s : "fhfa");
export const DEFAULT_RENTCAST_LIMIT = 40;
// A RentCast estimate is asked for again after this.
const RENTCAST_EVERY_MS = 6.5 * 24 * 60 * 60 * 1000;

export interface PropertyValueSettings {
  autoUpdate?: boolean;
  source?: ValueSource;
  showZillow?: boolean;
  rentcastLimit?: number;
}

// An estimate from a valuation service, and when it was made.
export interface Estimate {
  value: number;
  low?: number | null;
  high?: number | null;
  asOf: string;
}

// What the plugin last worked out, by "property:<id>" or "note:<id>".
export interface Valuation {
  address: string | null;
  geo: Geo;
  fhfa: IndexValue | null;
  rentcast: Estimate | null;
  zillow: Estimate | null;
  checkedAt: string;
}
export interface Valuations {
  refreshedAt: string;
  // RentCast lookups this book made in the month (YYYY-MM).
  rentcastMonth?: string;
  rentcastUsed?: number;
  items: Record<string, Valuation>;
}
// A note's collateral, as valued when the loan was made, by note id.
export type NoteBases = Record<string, number>;

// Shared by one run across books: FRED series fetched once, and the
// instance's Zillow lookups counted.
export interface Run {
  series: SeriesCache;
  zillowLeft: number;
  fetcher: typeof fetch;
}
export const newRun = (fetcher: typeof fetch = fetch): Run => ({ series: new Map(), zillowLeft: MAX_PER_RUN, fetcher });

export async function getApiKey(admin: SupabaseClient, orgId: string, name: ApiKeyName): Promise<string | null> {
  const stored = await getPluginData<{ encrypted?: string }>(admin, orgId, PLUGIN_ID, API_KEYS[name]);
  if (!stored?.encrypted) return null;
  try {
    return decryptToken(stored.encrypted);
  } catch {
    return null;
  }
}

interface Target {
  key: string;
  propertyId?: string;
  address: string | null;
  // As RentCast wants it; a note's is as typed.
  rentcastAddress: string | null;
  state?: string;
  base: number | null;
  baseDate: string | null;
}

async function targetsOf(admin: SupabaseClient, orgId: string): Promise<Target[]> {
  const [{ data: properties, error }, { data: notes, error: notesError }, bases] = await Promise.all([
    admin
      .from("properties")
      .select("id, address_street, address_city, address_state, address_zip, purchase_price, purchase_date")
      .eq("organization_id", orgId)
      .eq("kind", "real_estate")
      // Lookups that run out go to the longest-unvalued first.
      .order("last_valuation_at", { ascending: true, nullsFirst: true }),
    admin.from("mortgage_notes").select("id, property_address, origination_date").eq("organization_id", orgId),
    getPluginData<NoteBases>(admin, orgId, PLUGIN_ID, NOTE_BASES_KEY),
  ]);
  if (error) throw error;
  if (notesError) throw notesError;
  return [
    ...(properties ?? []).map((p) => ({
      key: `property:${p.id}`,
      propertyId: p.id as string,
      address: addressOf(p),
      rentcastAddress: rentcastAddress(p),
      state: (p.address_state as string | null)?.toUpperCase() ?? undefined,
      base: p.purchase_price === null ? null : Number(p.purchase_price),
      baseDate: p.purchase_date as string | null,
    })),
    ...(notes ?? []).map((n) => {
      const address = (n.property_address as string | null)?.trim() || null;
      return {
        key: `note:${n.id}`,
        address,
        rentcastAddress: address,
        state: address ? stateIn(address) : undefined,
        base: bases?.[n.id as string] ?? null,
        baseDate: n.origination_date as string,
      };
    }),
  ];
}

const fresh = (e: Estimate | null | undefined, now: number) => !!e && now - Date.parse(e.asOf) < RENTCAST_EVERY_MS;

// Values a book's properties and the collateral of its mortgage notes, from
// each source it has set up, and, when the book asked, replaces each
// property's estimated value with the source it picked.
export async function valueBook(admin: SupabaseClient, orgId: string, run: Run): Promise<{ updated: number; missed: number }> {
  const settings = await getPluginSettings<PropertyValueSettings>(admin, orgId, PLUGIN_ID);
  const source = valueSource(settings.source);
  const [fredKey, rentcastKey] = await Promise.all([getApiKey(admin, orgId, "fred"), getApiKey(admin, orgId, "rentcast")]);
  const zillow = !!process.env.PROPERTY_VALUE_API_URL && (settings.showZillow === true || (source === "zillow" && settings.autoUpdate === true));
  // Nothing to look up: no address goes anywhere.
  if (!fredKey && !rentcastKey && !zillow) return { updated: 0, missed: 0 };

  const previous = await getPluginData<Valuations>(admin, orgId, PLUGIN_ID, VALUATIONS_KEY);
  const now = Date.now();
  const month = new Date(now).toISOString().slice(0, 7);
  let rentcastUsed = previous?.rentcastMonth === month ? (previous.rentcastUsed ?? 0) : 0;
  const rentcastLimit = Number.isFinite(settings.rentcastLimit) && settings.rentcastLimit! >= 0 ? settings.rentcastLimit! : DEFAULT_RENTCAST_LIMIT;

  const items: Record<string, Valuation> = {};
  let updated = 0;
  let missed = 0;
  for (const t of await targetsOf(admin, orgId)) {
    const old = previous?.items[t.key];
    const moved = !old || old.address !== t.address;
    // An address is placed once; again only when it changes.
    const geo: Geo = !moved ? old.geo : t.address && fredKey ? await geocode(t.address, run.fetcher) : { state: t.state };
    const fhfa =
      fredKey && t.base && t.base > 0 && t.baseDate ? await valueByIndex(t.base, t.baseDate, geo, fredKey, run.series, run.fetcher) : null;

    // Each lookup RentCast counts against the book's month; a week-old one is kept.
    let rentcast = moved ? null : (old?.rentcast ?? null);
    if (rentcastKey && t.rentcastAddress && !fresh(rentcast, now) && rentcastUsed < rentcastLimit) {
      rentcastUsed++;
      const e = await lookupRentcast(t.rentcastAddress, rentcastKey, run.fetcher);
      if (e) rentcast = { ...e, asOf: new Date(now).toISOString() };
    }

    let zestimate = moved ? null : (old?.zillow ?? null);
    if (zillow && t.address && run.zillowLeft > 0) {
      run.zillowLeft--;
      const value = await lookupValue(t.address, process.env, run.fetcher);
      if (value !== null) zestimate = { value, asOf: new Date(now).toISOString() };
    }
    items[t.key] = { address: t.address, geo, fhfa, rentcast, zillow: zestimate, checkedAt: new Date(now).toISOString() };

    if (!t.propertyId || settings.autoUpdate !== true) continue;
    const value = source === "rentcast" ? rentcast?.value : source === "zillow" ? zestimate?.value : fhfa?.value;
    if (value == null) {
      missed++;
      continue;
    }
    const { error } = await admin
      .from("properties")
      .update({ estimated_value: value, last_valuation_at: new Date(now).toISOString() })
      .eq("id", t.propertyId);
    if (error) throw error;
    updated++;
  }
  await setPluginData(admin, orgId, PLUGIN_ID, VALUATIONS_KEY, {
    refreshedAt: new Date(now).toISOString(),
    rentcastMonth: month,
    rentcastUsed,
    items,
  } satisfies Valuations);
  return { updated, missed };
}

// Weekly, for every book the plugin is on in; a suspended book is skipped.
export async function updatePropertyValues(): Promise<{ updated: number; missed: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("organizations").select("id").is("suspended_at", null);
  if (error) throw error;
  const run = newRun();
  const total = { updated: 0, missed: 0 };
  for (const { id } of (data ?? []) as { id: string }[]) {
    if (!(await getOrgEnabledPluginIds(admin, id)).includes(PLUGIN_ID)) continue;
    const r = await valueBook(admin, id, run);
    total.updated += r.updated;
    total.missed += r.missed;
  }
  return total;
}

export const propertyValuesServer: ServerPluginParts = {
  jobs: [{ name: "property-values", minIntervalSeconds: PROPERTY_VALUE_INTERVAL_SECONDS, run: updatePropertyValues }],
};

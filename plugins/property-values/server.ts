// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ServerPluginParts } from "@/lib/plugins/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgEnabledPluginIds, getPluginSettings } from "@/lib/plugins/settings";

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

interface PropertyRow {
  id: string;
  organization_id: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  last_valuation_at: string | null;
}

// Weekly: properties in books that turned it on, the longest-unvalued first.
export async function updatePropertyValues(): Promise<{ updated: number; missed: number }> {
  if (!process.env.PROPERTY_VALUE_API_URL || !process.env.PROPERTY_VALUE_API_KEY) return { updated: 0, missed: 0 };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("properties")
    .select("id, organization_id, address_street, address_city, address_state, address_zip, last_valuation_at, organizations!inner(suspended_at)")
    // A suspended book's properties don't spend the provider's lookups.
    .is("organizations.suspended_at", null)
    .not("address_street", "is", null)
    .order("last_valuation_at", { ascending: true, nullsFirst: true });
  if (error) throw error;

  const allowed = new Map<string, boolean>();
  let updated = 0;
  let missed = 0;
  for (const p of (data ?? []) as PropertyRow[]) {
    if (updated + missed >= MAX_PER_RUN) break;
    if (!allowed.has(p.organization_id)) {
      const on =
        (await getOrgEnabledPluginIds(admin, p.organization_id)).includes("property-values") &&
        (await getPluginSettings<{ autoUpdate?: boolean }>(admin, p.organization_id, "property-values")).autoUpdate === true;
      allowed.set(p.organization_id, on);
    }
    const address = allowed.get(p.organization_id) ? addressOf(p) : null;
    if (!address) continue;
    const value = await lookupValue(address);
    if (value === null) {
      missed++;
      continue;
    }
    await admin.from("properties").update({ estimated_value: value, last_valuation_at: new Date().toISOString() }).eq("id", p.id);
    updated++;
  }
  return { updated, missed };
}

export const propertyValuesServer: ServerPluginParts = {
  jobs: [{ name: "property-values", minIntervalSeconds: PROPERTY_VALUE_INTERVAL_SECONDS, run: updatePropertyValues }],
};

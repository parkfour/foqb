import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const store = new Map<string, unknown>();
let settings: Record<string, unknown> = {};
vi.mock("@/lib/plugins/settings", () => ({
  getPluginSettings: async () => settings,
  getOrgEnabledPluginIds: async () => ["property-values"],
}));
vi.mock("@/lib/plugins/data", () => ({
  getPluginData: async (_s: unknown, _o: string, _p: string, key: string) => store.get(key) ?? null,
  setPluginData: async (_s: unknown, _o: string, _p: string, key: string, value: unknown) => void store.set(key, value),
}));
vi.mock("@/lib/crypto/token-encryption", () => ({ decryptToken: (s: string) => s.replace(/^enc:/, "") }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import { newRun, valueBook } from "@/plugins/property-values/server";

const updates: { values: Record<string, unknown>; id: unknown }[] = [];
function admin(properties: unknown[], notes: unknown[]): SupabaseClient {
  const query = (data: unknown[]) => {
    const q = { eq: () => q, order: () => q, then: (r: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(r) };
    return q;
  };
  return {
    from: (table: string) => ({
      select: () => query(table === "properties" ? properties : notes),
      update: (values: Record<string, unknown>) => ({ eq: async (_c: string, id: unknown) => (updates.push({ values, id }), { error: null }) }),
    }),
  } as unknown as SupabaseClient;
}

// Census places every address in Chicago's division; FRED's index doubled;
// RentCast says $650,000.
const fetcher = vi.fn(async (url: string) =>
  url.includes("census.gov")
    ? Response.json({ result: { addressMatches: [{ geographies: { "Metropolitan Divisions": [{ METDIV: "16984", NAME: "Chicago div" }], States: [{ STUSAB: "IL" }] } }] } })
    : url.includes("rentcast.io")
      ? Response.json({ price: 650000, priceRangeLow: 600000, priceRangeHigh: 700000 })
      : Response.json({ observations: [{ date: "2019-07-01", value: "100" }, { date: "2026-04-01", value: "200" }] }),
) as unknown as typeof fetch;
const rentcastCalls = () => vi.mocked(fetcher).mock.calls.filter(([u]) => String(u).includes("rentcast.io")).length;

const home = { id: "p1", address_street: "1 Main St", address_city: "Chicago", address_state: "IL", address_zip: "60606", purchase_price: "300000", purchase_date: "2019-08-01" };
const note = { id: "n1", property_address: "9 Elm St, Chicago, IL 60606", origination_date: "2019-07-15" };

describe("valuing a book", () => {
  beforeEach(() => {
    store.clear();
    updates.length = 0;
    settings = {};
    vi.mocked(fetcher).mockClear();
  });

  it("sends no address anywhere without a FRED key", async () => {
    expect(await valueBook(admin([home], [note]), "org", newRun(fetcher))).toEqual({ updated: 0, missed: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("values properties and notes' collateral, but leaves estimated values alone unless asked", async () => {
    store.set("fred-key", { encrypted: "enc:key" });
    store.set("note-bases", { n1: 250000 });
    await valueBook(admin([home], [note]), "org", newRun(fetcher));
    const { items } = store.get("valuations") as { items: Record<string, { fhfa: { value: number; series: string } | null }> };
    expect(items["property:p1"].fhfa).toMatchObject({ value: 600000, series: "ATNHPIUS16984Q" });
    expect(items["note:n1"].fhfa).toMatchObject({ value: 500000 });
    expect(updates).toEqual([]);
  });

  it("replaces each property's estimated value when the book asked, and places an address only once", async () => {
    store.set("fred-key", { encrypted: "enc:key" });
    settings = { autoUpdate: true, source: "fhfa" };
    expect(await valueBook(admin([home], []), "org", newRun(fetcher))).toEqual({ updated: 1, missed: 0 });
    expect(updates[0]).toMatchObject({ values: { estimated_value: 600000 }, id: "p1" });
    vi.mocked(fetcher).mockClear();
    await valueBook(admin([home], []), "org", newRun(fetcher));
    expect(vi.mocked(fetcher).mock.calls.map(([u]) => String(u)).some((u) => u.includes("census.gov"))).toBe(false);
  });

  it("counts a property it can't value, and leaves its value alone", async () => {
    store.set("fred-key", { encrypted: "enc:key" });
    settings = { autoUpdate: true };
    expect(await valueBook(admin([{ ...home, purchase_price: null }], []), "org", newRun(fetcher))).toEqual({ updated: 0, missed: 1 });
    expect(updates).toEqual([]);
  });

  it("looks each property up on RentCast once a week, within the book's monthly limit", async () => {
    store.set("rentcast-key", { encrypted: "enc:rc-key-0123456789abcdef" });
    settings = { autoUpdate: true, source: "rentcast", rentcastLimit: 1 };
    const second = { ...home, id: "p2", address_street: "2 Main St" };
    expect(await valueBook(admin([home, second], []), "org", newRun(fetcher))).toEqual({ updated: 1, missed: 1 });
    expect(rentcastCalls()).toBe(1);
    expect(String(vi.mocked(fetcher).mock.calls.find(([u]) => String(u).includes("rentcast"))![0])).toContain(
      "address=1+Main+St%2C+Chicago%2C+IL%2C+60606",
    );
    expect(updates[0]).toMatchObject({ values: { estimated_value: 650000 }, id: "p1" });
    const v = store.get("valuations") as { rentcastUsed: number; items: Record<string, { rentcast: { value: number; low: number } | null }> };
    expect(v.rentcastUsed).toBe(1);
    expect(v.items["property:p1"].rentcast).toMatchObject({ value: 650000, low: 600000 });
    expect(v.items["property:p2"].rentcast).toBeNull();

    // The limit's spent, and p1's estimate is less than a week old: no lookup.
    vi.mocked(fetcher).mockClear();
    await valueBook(admin([home, second], []), "org", newRun(fetcher));
    expect(rentcastCalls()).toBe(0);
    expect((store.get("valuations") as { items: Record<string, { rentcast: unknown }> }).items["property:p1"].rentcast).toMatchObject({ value: 650000 });
  });
});

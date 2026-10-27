import { describe, expect, it, vi } from "vitest";
import { addressOf, findZestimate, lookupValue } from "@/plugins/property-values/server";
import { lookupRentcast, rentcastAddress } from "@/plugins/property-values/rentcast";
import { FRED_KEY, candidates, geocode, indexValue, quarterLabel, quarterOf, stateIn, valueByIndex } from "@/plugins/property-values/fhfa";

describe("property values plugin", () => {
  it("finds the Zestimate wherever the provider puts it", () => {
    expect(findZestimate({ zestimate: 512300 })).toBe(512300);
    expect(findZestimate({ data: { property: { Zestimate: "498000" } } })).toBe(498000);
    expect(findZestimate({ price: 1, zestimate: null })).toBeNull();
  });

  it("needs a street and a zip, or a city and state", () => {
    expect(addressOf({ address_street: "1 Main St", address_city: "Omaha", address_state: "NE", address_zip: "68136" })).toBe(
      "1 Main St, Omaha, NE 68136",
    );
    expect(addressOf({ address_street: "1 Main St", address_city: null, address_state: null, address_zip: null })).toBeNull();
  });

  it("asks the instance's provider with its key, and does nothing without one", async () => {
    const fetcher = vi.fn(async () => Response.json({ zestimate: 400000 }));
    const env = { PROPERTY_VALUE_API_URL: "https://api.example.com/property?address={address}", PROPERTY_VALUE_API_KEY: "k", PROPERTY_VALUE_API_HOST: "api.example.com" };
    expect(await lookupValue("1 Main St, Omaha, NE", env, fetcher as unknown as typeof fetch)).toBe(400000);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/property?address=1%20Main%20St%2C%20Omaha%2C%20NE");
    expect(init.headers).toEqual({ "X-RapidAPI-Key": "k", "X-RapidAPI-Host": "api.example.com" });
    expect(await lookupValue("x", {}, fetcher as unknown as typeof fetch)).toBeNull();
    expect(await lookupValue("x", { ...env, PROPERTY_VALUE_API_URL: "http://insecure/{address}" }, fetcher as unknown as typeof fetch)).toBeNull();
  });
});

describe("FHFA house price index values", () => {
  const obs = [
    { date: "2019-07-01", value: 200 },
    { date: "2026-01-01", value: 290 },
    { date: "2026-04-01", value: 300 },
  ];

  it("dates a purchase by its quarter, as FRED does", () => {
    expect(quarterOf("2019-08-15")).toBe("2019-07-01");
    expect(quarterOf("2026-12-31")).toBe("2026-10-01");
    expect(quarterLabel("2026-04-01")).toBe("Q2 2026");
  });

  it("moves the price with the index from the purchase quarter to the latest", () => {
    expect(indexValue(400000, "2019-09-30", obs)).toEqual({
      value: 600000,
      from: "2019-07-01",
      to: "2026-04-01",
      fromIndex: 200,
      toIndex: 300,
    });
    // Bought in a quarter not yet published, or before the series starts.
    expect(indexValue(400000, "2026-08-01", obs)).toBeNull();
    expect(indexValue(400000, "1970-01-01", obs)).toBeNull();
  });

  it("tries the metro division, then the metro area, the state and the US", () => {
    expect(candidates({ division: { code: "16984", name: "Chicago div" }, metro: { code: "16980", name: "Chicago" }, state: "IL" }).map((c) => c.series)).toEqual([
      "ATNHPIUS16984Q",
      "ATNHPIUS16980Q",
      "ILSTHPI",
      "USSTHPI",
    ]);
    expect(candidates({}).map((c) => c.series)).toEqual(["USSTHPI"]);
  });

  it("falls back past a series FRED doesn't have, and fetches each series once", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const series = new URL(url).searchParams.get("series_id");
      if (series === "ATNHPIUS16980Q") return new Response("Bad Request", { status: 400 });
      return Response.json({ observations: [{ date: "2019-07-01", value: "100" }, { date: "2026-04-01", value: "." }, { date: "2026-01-01", value: "150" }] });
    });
    const cache = new Map();
    const geo = { metro: { code: "16980", name: "Chicago" }, state: "IL" };
    const v = await valueByIndex(100000, "2019-07-04", geo, "k".repeat(32), cache, fetcher as unknown as typeof fetch);
    expect(v).toMatchObject({ value: 150000, series: "ILSTHPI", index: "IL statewide", to: "2026-01-01" });
    await valueByIndex(200000, "2019-07-04", geo, "k".repeat(32), cache, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("places an address with the Census geocoder, or by its state when it can't", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        result: {
          addressMatches: [
            {
              addressComponents: { state: "IL" },
              geographies: {
                "Metropolitan Divisions": [{ METDIV: "16984", NAME: "Chicago-Naperville-Schaumburg, IL Metro Division" }],
                "Metropolitan Statistical Areas": [{ CBSA: "16980", NAME: "Chicago-Naperville-Elgin, IL-IN Metro Area" }],
                States: [{ STUSAB: "IL" }],
              },
            },
          ],
        },
      }),
    );
    expect(await geocode("233 S Wacker Dr, Chicago, IL 60606", fetcher as unknown as typeof fetch)).toEqual({
      division: { code: "16984", name: "Chicago-Naperville-Schaumburg, IL Metro Division" },
      metro: { code: "16980", name: "Chicago-Naperville-Elgin, IL-IN Metro Area" },
      state: "IL",
    });
    const down = vi.fn(async () => new Response("", { status: 503 }));
    expect(await geocode("1 Main St, Omaha, NE 68136", down as unknown as typeof fetch)).toEqual({ state: "NE" });
    expect(stateIn("12 Elm St, Austin, tx 78701-1234")).toBe("TX");
    expect(stateIn("somewhere")).toBeUndefined();
  });

  it("takes a FRED key only in its own shape", () => {
    expect(FRED_KEY.test("abcdef0123456789abcdef0123456789")).toBe(true);
    expect(FRED_KEY.test("not a key")).toBe(false);
  });
});

describe("RentCast estimates", () => {
  it("needs the whole address, as RentCast wants it", () => {
    expect(rentcastAddress({ address_street: "5500 Grand Lake Dr", address_city: "San Antonio", address_state: "TX", address_zip: "78244" })).toBe(
      "5500 Grand Lake Dr, San Antonio, TX, 78244",
    );
    expect(rentcastAddress({ address_street: "5500 Grand Lake Dr", address_city: null, address_state: "TX", address_zip: "78244" })).toBeNull();
  });

  it("sends the key in its header and reads the price and range", async () => {
    const fetcher = vi.fn(async () => Response.json({ price: 321000, priceRangeLow: 300000, priceRangeHigh: "x" }));
    expect(await lookupRentcast("1 A St, B, TX, 78244", "key-0123456789abcdef", fetcher as unknown as typeof fetch)).toEqual({
      value: 321000,
      low: 300000,
      high: null,
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.rentcast.io/v1/avm/value?address=1+A+St%2C+B%2C+TX%2C+78244");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("key-0123456789abcdef");
    const denied = vi.fn(async () => new Response("", { status: 401 }));
    expect(await lookupRentcast("x", "k", denied as unknown as typeof fetch)).toBeNull();
  });
});

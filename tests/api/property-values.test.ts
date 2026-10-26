import { describe, expect, it, vi } from "vitest";
import { addressOf, findZestimate, lookupValue } from "@/plugins/property-values/server";

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

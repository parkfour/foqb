// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SalesTaxLookup } from "@/lib/plugins/types";

const { state } = vi.hoisted(() => ({
  state: { role: "owner" as string | null, allowed: true, lookups: [] as SalesTaxLookup[] },
}));
vi.mock("@/lib/org/current", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/current")>()),
  getCurrentUserRole: async () => state.role,
}));
vi.mock("@/lib/auth/rate-limit", () => ({ checkRateLimit: async () => state.allowed }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/plugins/server-loader", () => ({ salesTaxLookups: async () => state.lookups }));

import { lookupSalesTaxRates } from "@/app/(dashboard)/settings/sales-tax-actions";

const address = { street: " 1 Main St ", city: "Austin", state: "TX", zip: "78701", country: "US" };

beforeEach(() => {
  state.role = "owner";
  state.allowed = true;
  state.lookups = [];
});

describe("lookupSalesTaxRates", () => {
  it("gathers every plugin's rates for the address, trimmed, leaving out impossible ones", async () => {
    const rates = vi.fn(async () => [
      { name: "Texas state", rate: 6.25 },
      { name: "Austin city", rate: 1 },
      { name: "Bogus", rate: 0 },
      { name: "Also bogus", rate: 100 },
    ]);
    state.lookups = [{ name: "TaxRates.io", rates }];

    expect(await lookupSalesTaxRates("org-1", address)).toEqual({
      rates: [
        { source: "TaxRates.io", name: "Texas state", rate: 6.25 },
        { source: "TaxRates.io", name: "Austin city", rate: 1 },
      ],
    });
    expect(rates).toHaveBeenCalledWith({ street: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US" });
  });

  it("keeps the rates it got when one plugin fails, and reports the failure when none answer", async () => {
    const down: SalesTaxLookup = {
      name: "Down",
      rates: async () => {
        throw new Error("503");
      },
    };
    state.lookups = [down, { name: "Up", rates: async () => [{ name: "State", rate: 5 }] }];
    expect(await lookupSalesTaxRates("org-1", address)).toEqual({ rates: [{ source: "Up", name: "State", rate: 5 }] });

    state.lookups = [down];
    expect(await lookupSalesTaxRates("org-1", address)).toEqual({ error: "Down: 503" });
  });

  it("refuses a viewer, an address without a postal code, and too many lookups", async () => {
    state.lookups = [{ name: "Up", rates: vi.fn(async () => []) }];
    state.role = "viewer";
    expect(await lookupSalesTaxRates("org-1", address)).toMatchObject({ error: expect.stringMatching(/can't change/) });
    state.role = "owner";
    expect(await lookupSalesTaxRates("org-1", { ...address, zip: " " })).toMatchObject({ error: expect.stringMatching(/postal code/) });
    state.allowed = false;
    expect(await lookupSalesTaxRates("org-1", address)).toMatchObject({ error: expect.stringMatching(/Too many/) });
    expect(state.lookups[0].rates).not.toHaveBeenCalled();
  });
});

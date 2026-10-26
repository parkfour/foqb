// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { state, securityPriceMock } = vi.hoisted(() => ({
  state: { role: "owner" as string | null, client: null as unknown },
  securityPriceMock: vi.fn(),
}));
vi.mock("@/lib/org/current", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/current")>()),
  getCurrentOrgId: async () => "org-1",
  getCurrentUserRole: async () => state.role,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/plugins/settings", () => ({ getOrgEnabledPluginIds: async () => ["security-prices"] }));
vi.mock("@/lib/plugins/server-loader", () => ({ securityPrice: securityPriceMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updatePrices } from "@/app/(dashboard)/investments/actions";

beforeEach(() => {
  state.role = "owner";
  securityPriceMock.mockReset().mockResolvedValue({ price: 250, asOf: "2026-10-23", source: "Stooq" });
});

describe("updatePrices", () => {
  it("lets a viewer neither ask the price service nor save", async () => {
    state.role = "viewer";
    state.client = createSupabaseMock({ tables: {} }).client;
    expect(await updatePrices()).toEqual({ error: "You can't change prices in this book" });
    expect(securityPriceMock).not.toHaveBeenCalled();
  });

  it("reports a price it couldn't save instead of claiming success", async () => {
    state.client = createSupabaseMock({
      tables: { securities: { select: ok([{ id: "s1", symbol: "VTI" }]) }, security_prices: { upsert: fail("permission denied") } },
    }).client;
    expect(await updatePrices()).toEqual({ error: "Couldn't save the price for VTI: permission denied" });
  });

  it("saves each price", async () => {
    state.client = createSupabaseMock({
      tables: { securities: { select: ok([{ id: "s1", symbol: "VTI" }]) }, security_prices: { upsert: ok(null) } },
    }).client;
    expect(await updatePrices()).toEqual({ error: null });
  });
});

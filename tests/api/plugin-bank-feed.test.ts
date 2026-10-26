// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankFeedAccount, ServerPluginParts } from "@/lib/plugins/types";

const { enabledByBook, ingestMock, books } = vi.hoisted(() => ({
  enabledByBook: {} as Record<string, string[]>,
  ingestMock: vi.fn(),
  books: { value: [] as { id: string }[] },
}));
vi.mock("@/lib/plugins/settings", () => ({ getOrgEnabledPluginIds: async (_a: unknown, orgId: string) => enabledByBook[orgId] ?? [] }));
vi.mock("@/lib/bank/plugin-feed", () => ({ ingestBankFeed: ingestMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ is: async () => ({ data: books.value, error: null }) }) }) }),
}));

import { enabledPluginJobs } from "@/lib/plugins/server-loader";

const account: BankFeedAccount = { id: "a1", name: "Girokonto", kind: "asset", transactions: [] };

beforeEach(() => {
  for (const k of Object.keys(enabledByBook)) delete enabledByBook[k];
  ingestMock.mockReset();
});

describe("a plugin's bank feed job", () => {
  it("fetches and books each unsuspended book the plugin is on in, and carries on past a failure", async () => {
    books.value = [{ id: "on-1" }, { id: "off" }, { id: "failing" }, { id: "on-2" }];
    Object.assign(enabledByBook, { "on-1": ["gc"], failing: ["gc"], "on-2": ["gc", "other"] });
    const fetch = vi.fn(async (orgId: string) => {
      if (orgId === "failing") throw new Error("token expired");
      return [account];
    });
    const parts: Record<string, ServerPluginParts> = { gc: { bankFeed: { name: "GoCardless", minIntervalSeconds: 3600, fetch } } };
    ingestMock.mockResolvedValue(1);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const [job] = enabledPluginJobs(["gc"], parts);
    expect(await job.run()).toEqual({ books: 2, failed: 1 });

    expect(fetch.mock.calls.map(([id]) => id)).toEqual(["on-1", "failing", "on-2"]);
    expect(ingestMock.mock.calls.map(([, pluginId, orgId, accounts]) => [pluginId, orgId, accounts])).toEqual([
      ["gc", "on-1", [account]],
      ["gc", "on-2", [account]],
    ]);
    expect(errors).toHaveBeenCalledWith("GoCardless bank feed failed for book failing", expect.any(Error));
    errors.mockRestore();
  });
});

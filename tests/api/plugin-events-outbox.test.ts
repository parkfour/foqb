// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";

const { emitHookMock, rpcMock } = vi.hoisted(() => ({ emitHookMock: vi.fn(), rpcMock: vi.fn() }));
vi.mock("@/lib/plugins/hooks", () => ({ emitHook: emitHookMock }));
vi.mock("@/lib/plugins/server-loader", () => ({ ensureServerPluginsLoaded: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: rpcMock }) }));

import { deliverPluginEvents } from "@/lib/plugins/events-outbox";

const row = (id: number, event: string, payload: object) => ({ id, organization_id: "org-1", event, payload, created_at: "" });

beforeEach(() => {
  emitHookMock.mockReset();
  rpcMock.mockReset();
});

describe("deliverPluginEvents", () => {
  it("hands each claimed event to the handlers in order, with its book", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [row(2, "period:locked", { lockDate: "2026-09-30", previousLockDate: null }), row(1, "journal_entry:posted", { journalEntryId: "je-1" })],
      error: null,
    });

    expect(await deliverPluginEvents()).toEqual({ delivered: 2 });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(emitHookMock.mock.calls).toEqual([
      ["journal_entry:posted", { journalEntryId: "je-1", orgId: "org-1" }],
      ["period:locked", { lockDate: "2026-09-30", previousLockDate: null, orgId: "org-1" }],
    ]);
  });

  it("keeps claiming while batches come back full", async () => {
    const full = Array.from({ length: 200 }, (_, i) => row(i + 1, "journal_entry:posted", { journalEntryId: `je-${i}` }));
    rpcMock.mockResolvedValueOnce({ data: full, error: null }).mockResolvedValueOnce({ data: [row(201, "journal_entry:posted", {})], error: null });

    expect(await deliverPluginEvents()).toEqual({ delivered: 201 });
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the claim fails, delivering nothing", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: new Error("db down") });
    await expect(deliverPluginEvents()).rejects.toThrow("db down");
    expect(emitHookMock).not.toHaveBeenCalled();
  });
});

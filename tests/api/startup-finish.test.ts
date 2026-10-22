import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock, fail, ok } from "./supabase-mock";

const { serverClientMock } = vi.hoisted(() => ({ serverClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: serverClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/org/book-clock", () => ({ bookToday: async () => "2026-10-22" }));
vi.mock("@/lib/org/current", () => ({
  getCurrentOrgId: async () => "org-1",
  getCurrentUserRole: async () => "owner",
  canWrite: () => true,
  getWorkspaceType: async () => "household",
}));

import { finishStartup } from "@/plugins/startup-assistant/actions";

function mockClient(deleteResult = ok(null)) {
  const { client, tables } = createSupabaseMock({
    tables: { startup_assistant: { update: ok(null) }, net_worth_snapshots: { delete: deleteResult } },
  });
  serverClientMock.mockResolvedValue(client);
  return tables;
}

describe("finishStartup", () => {
  it("starts the net worth chart over from the book's today", async () => {
    const tables = mockClient();
    expect(await finishStartup()).toEqual({ success: true, value: null });
    expect(tables.net_worth_snapshots.delete).toHaveBeenCalled();
    expect(tables.net_worth_snapshots.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(tables.net_worth_snapshots.lt).toHaveBeenCalledWith("date", "2026-10-22");
  });

  it("says so when the old points can't be cleared", async () => {
    mockClient(fail("denied"));
    expect(await finishStartup()).toEqual({ success: false, error: "denied" });
  });
});

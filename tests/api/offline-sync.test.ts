import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, saveOfflineEntry } from "@/lib/db/offline";
import { syncOfflineEntries } from "@/components/providers/online-status-provider";

function entry(memo: string) {
  return saveOfflineEntry({ organization_id: "org-1", entry_date: "2026-10-15", memo, lines: [] });
}

function respond(status: number, body: unknown = {}) {
  return { ok: status < 300, status, json: async () => body };
}

describe("syncOfflineEntries", () => {
  beforeEach(async () => {
    await db.offline_entries.clear();
    vi.restoreAllMocks();
  });

  it("marks accepted entries synced", async () => {
    const id = await entry("Valid");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, { success: true, id: "je-1" })));

    await syncOfflineEntries();

    expect(await db.offline_entries.get(id)).toMatchObject({ synced: true, status: "synced" });
  });

  it("sets a refused entry aside with its reason and carries on with the rest", async () => {
    const bad = await entry("Locked");
    const good = await entry("Fine");
    const fetchMock = vi.fn().mockImplementation(async (_url, init) =>
      JSON.parse(init.body).memo === "Locked"
        ? respond(400, { error: "entry_date falls within a locked period" })
        : respond(200, { success: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await syncOfflineEntries();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.offline_entries.get(bad)).toMatchObject({
      status: "failed",
      error_message: "entry_date falls within a locked period",
    });
    expect((await db.offline_entries.get(good))?.status).toBe("synced");

    // A failed entry isn't sent again on the next reconnect.
    fetchMock.mockClear();
    await syncOfflineEntries();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["signed out", () => respond(401, { error: "Unauthorized" })],
    ["a server error", () => respond(500, { error: "connection lost" })],
    ["a dropped connection", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("keeps every entry queued on %s", async (_label, reply) => {
    const first = await entry("One");
    const second = await entry("Two");
    const fetchMock = vi.fn().mockImplementation(reply);
    vi.stubGlobal("fetch", fetchMock);

    await syncOfflineEntries();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await db.offline_entries.get(first))?.status).toBe("pending");
    expect((await db.offline_entries.get(second))?.status).toBe("pending");
  });
});

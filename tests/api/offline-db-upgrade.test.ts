import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it } from "vitest";

it("upgrades entries queued before version 2 so they still sync", async () => {
  const v1 = new Dexie("AppOfflineDatabase");
  v1.version(1).stores({
    offline_entries: "++id, organization_id, synced, created_at",
    offline_rules: "++id, organization_id, match_text",
  });
  const base = { organization_id: "org-1", entry_date: "2026-10-15", lines: [], created_at: "2026-10-15T00:00:00Z" };
  await v1.table("offline_entries").bulkAdd([
    { ...base, memo: "Queued", synced: false },
    { ...base, memo: "Done", synced: true },
  ]);
  v1.close();

  const { db } = await import("@/lib/db/offline");
  const rows = await db.offline_entries.orderBy("id").toArray();
  expect(rows.map((r) => [r.memo, r.status])).toEqual([
    ["Queued", "pending"],
    ["Done", "synced"],
  ]);
});

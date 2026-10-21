import Dexie, { type EntityTable } from "dexie";

export interface OfflineJournalLine {
  account_id: string;
  debit: number;
  credit: number;
}

export type OfflineEntryStatus = "pending" | "synced" | "failed";

export interface OfflineEntry {
  id: number;
  organization_id: string;
  entry_date: string;
  memo: string;
  lines: OfflineJournalLine[];
  synced: boolean;
  status: OfflineEntryStatus;
  error_message?: string;
  created_at: string;
}

export interface OfflineRule {
  id: number;
  organization_id: string;
  match_text: string;
  target_account_id: string;
}

class AppOfflineDatabase extends Dexie {
  offline_entries!: EntityTable<OfflineEntry, "id">;
  offline_rules!: EntityTable<OfflineRule, "id">;

  constructor() {
    super("AppOfflineDatabase");

    this.version(1).stores({
      offline_entries: "++id, organization_id, synced, created_at",
      offline_rules: "++id, organization_id, match_text",
    });

    this.version(2)
      .stores({
        offline_entries: "++id, organization_id, status, synced, created_at",
        offline_rules: "++id, organization_id, match_text",
      })
      .upgrade(async (tx) => {
        await tx
          .table("offline_entries")
          .toCollection()
          .modify((entry: OfflineEntry) => {
            entry.status = entry.synced ? "synced" : "pending";
          });
      });
  }
}

export const db = new AppOfflineDatabase();

export async function saveOfflineEntry(
  entry: Omit<OfflineEntry, "id" | "synced" | "created_at" | "status" | "error_message">,
): Promise<number> {
  return db.offline_entries.add({
    ...entry,
    synced: false,
    status: "pending",
    created_at: new Date().toISOString(),
  });
}

export async function getUnsyncedEntries(orgId: string): Promise<OfflineEntry[]> {
  return db.offline_entries
    .where("organization_id")
    .equals(orgId)
    .filter((entry) => entry.status === "pending")
    .toArray();
}

export async function markEntrySynced(id: number): Promise<void> {
  await db.offline_entries.update(id, { synced: true, status: "synced" });
}

// The server refused the entry itself (not a network or server outage), so
// retrying won't help. It stays on this device, with the reason, until the
// person dismisses it.
export async function markEntryFailed(id: number, errorMessage: string): Promise<void> {
  await db.offline_entries.update(id, { status: "failed", error_message: errorMessage });
}

export async function dismissFailedEntry(id: number): Promise<void> {
  await db.offline_entries.delete(id);
}

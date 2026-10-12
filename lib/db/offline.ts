import Dexie, { type EntityTable } from "dexie";

export interface OfflineJournalLine {
  account_id: string;
  debit: number;
  credit: number;
}

export interface OfflineEntry {
  id: number;
  organization_id: string;
  entry_date: string;
  memo: string;
  lines: OfflineJournalLine[];
  synced: boolean;
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
  }
}

export const db = new AppOfflineDatabase();

export async function saveOfflineEntry(
  entry: Omit<OfflineEntry, "id" | "synced" | "created_at">,
): Promise<number> {
  return db.offline_entries.add({
    ...entry,
    synced: false,
    created_at: new Date().toISOString(),
  });
}

export async function getUnsyncedEntries(orgId: string): Promise<OfflineEntry[]> {
  return db.offline_entries
    .where("organization_id")
    .equals(orgId)
    .filter((entry) => !entry.synced)
    .toArray();
}

export async function markEntrySynced(id: number): Promise<void> {
  await db.offline_entries.update(id, { synced: true });
}

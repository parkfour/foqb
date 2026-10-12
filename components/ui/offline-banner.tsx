"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { WifiOff } from "lucide-react";
import { db } from "@/lib/db/offline";
import { useOnlineStatus } from "@/components/providers/online-status-provider";

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const unsyncedCount =
    useLiveQuery(() => db.offline_entries.filter((entry) => !entry.synced).count(), []) ?? 0;

  if (isOnline && unsyncedCount === 0) {
    return null;
  }

  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium ${
        isOnline ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900"
      }`}
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      {isOnline
        ? `Syncing ${unsyncedCount} offline ${unsyncedCount === 1 ? "entry" : "entries"}…`
        : "You're offline. Changes are saved locally and will sync automatically."}
    </div>
  );
}

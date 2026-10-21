"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, WifiOff } from "lucide-react";
import { db, dismissFailedEntry } from "@/lib/db/offline";
import { useOnlineStatus } from "@/components/providers/online-status-provider";

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const pendingCount =
    useLiveQuery(() => db.offline_entries.where("status").equals("pending").count(), []) ?? 0;
  const failed = useLiveQuery(() => db.offline_entries.where("status").equals("failed").toArray(), []) ?? [];

  return (
    <>
      {(!isOnline || pendingCount > 0) && (
        <div
          role="status"
          className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium ${
            isOnline ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900"
          }`}
        >
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          {isOnline
            ? `Syncing ${pendingCount} offline ${pendingCount === 1 ? "entry" : "entries"}…`
            : "You're offline. Changes are saved locally and will sync automatically."}
        </div>
      )}
      {failed.length > 0 && (
        <div role="alert" className="bg-rose-100 px-4 py-2 text-sm text-rose-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {failed.length === 1 ? "An entry" : `${failed.length} entries`} saved offline could not be
            posted. Re-enter {failed.length === 1 ? "it" : "them"} once the problem is fixed.
          </p>
          <ul className="mt-1 space-y-1">
            {failed.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-2">
                <span>
                  {entry.entry_date} {entry.memo || "(no memo)"}: {entry.error_message}
                </span>
                <button
                  type="button"
                  onClick={() => void dismissFailedEntry(entry.id)}
                  className="rounded px-2 py-0.5 text-xs font-semibold text-rose-800 hover:bg-rose-200"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

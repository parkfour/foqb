"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { db, markEntryFailed, markEntrySynced } from "@/lib/db/offline";

function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

// Node's built-in global `navigator` (present since Node 21) has no `onLine`
// property, so touching `navigator.onLine` during SSR silently yields
// `undefined`. Always report `true` for the server snapshot instead.
function getServerSnapshot(): boolean {
  return true;
}

const OnlineStatusContext = createContext<boolean | null>(null);

export function useOnlineStatus(): boolean {
  const context = useContext(OnlineStatusContext);

  if (context === null) {
    throw new Error("useOnlineStatus must be used within an OnlineStatusProvider");
  }

  return context;
}

export async function syncOfflineEntries(): Promise<void> {
  const pending = await db.offline_entries.where("status").equals("pending").toArray();

  for (const entry of pending) {
    if (entry.id === undefined) continue;

    try {
      const response = await fetch("/api/journal-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: entry.organization_id,
          entry_date: entry.entry_date,
          memo: entry.memo,
          lines: entry.lines,
        }),
      });

      if (response.ok) {
        await markEntrySynced(entry.id);
      } else if (response.status === 401 || response.status >= 500) {
        // Signed out, or the server is having trouble: nothing is wrong
        // with the entries, so keep them all queued and try again later.
        break;
      } else {
        // The server refused this entry (unbalanced, locked period, not a
        // member...). Set it aside with the reason so it can't hold up the
        // entries behind it.
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        await markEntryFailed(entry.id, body.error ?? `Rejected (${response.status})`);
      }
    } catch {
      // Connection dropped again mid-sync; leave remaining entries queued
      // for the next reconnect.
      break;
    }
  }
}

export function OnlineStatusProvider({ children }: { children: ReactNode }) {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (isOnline) {
      void syncOfflineEntries();
    }
  }, [isOnline]);

  return <OnlineStatusContext.Provider value={isOnline}>{children}</OnlineStatusContext.Provider>;
}

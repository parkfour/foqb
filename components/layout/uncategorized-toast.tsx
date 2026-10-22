"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { countUncategorized } from "@/app/(dashboard)/transactions/actions";

const AWAY_MS = 30 * 60 * 1000;
const LAST_SEEN = "foqb:last-seen";

function lastSeen(): number {
  try {
    return Number(localStorage.getItem(LAST_SEEN)) || 0;
  } catch {
    return 0;
  }
}

function markSeen() {
  try {
    localStorage.setItem(LAST_SEEN, String(Date.now()));
  } catch {
    // Private window or blocked storage: every return counts as a while.
  }
}

// Coming back after a while (a new visit, or this tab out of sight for half
// an hour) with transactions waiting in the register: says how many.
export function UncategorizedToast() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const check = () => {
      const away = Date.now() - lastSeen() >= AWAY_MS;
      markSeen();
      if (away) countUncategorized().then(setCount, () => setCount(0));
    };
    const onVisibility = () => (document.visibilityState === "visible" ? check() : markSeen());
    check();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", markSeen);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", markSeen);
    };
  }, []);

  if (count === 0) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-lg"
    >
      <Link href="/register" onClick={() => setCount(0)} className="hover:underline">
        {count === 1 ? "1 transaction is" : `${count} transactions are`} waiting to be categorized
      </Link>
      <button type="button" aria-label="Dismiss" onClick={() => setCount(0)} className="text-slate-400 hover:text-slate-700">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

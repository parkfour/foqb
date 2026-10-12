"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { finishReconnect, rememberLinkSession } from "./plaid-link-session";

// Re-authenticates an existing bank connection through Plaid Link update
// mode. Unlike connecting again, this keeps the same Plaid Item, so account
// and transaction ids don't change and nothing is imported twice.
export function ReconnectBankButton({ enrollmentId }: { enrollmentId: string }) {
  const router = useRouter();
  const [isScriptReady, setIsScriptReady] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reconnect() {
    if (!window.Plaid) {
      setError("Plaid Link is not configured");
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      const response = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId }),
      });
      if (!response.ok) throw new Error("Failed to start reconnecting");
      const { linkToken } = (await response.json()) as { linkToken: string };

      rememberLinkSession({ token: linkToken, mode: "reconnect", enrollmentId });
      window.Plaid.create({
        token: linkToken,
        onSuccess: () => {
          void finishReconnect(enrollmentId).then((ok) => {
            if (!ok) setError("Reconnected at the bank, but saving that failed — try again");
            router.refresh();
          });
        },
      }).open();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start reconnecting");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Script
        src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"
        strategy="afterInteractive"
        onReady={() => setIsScriptReady(true)}
      />
      <button
        type="button"
        onClick={() => void reconnect()}
        disabled={!isScriptReady || isWorking}
        className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {isWorking ? "Opening…" : "Reconnect"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

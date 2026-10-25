"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// The setup token from a SimpleFIN Bridge, pasted in. An alternative to
// Plaid that needs no approval: the person pays SimpleFIN directly.
export function SimplefinConnect({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/bank/simplefin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, setupToken: token }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; accounts?: number };
      if (!res.ok) throw new Error(json.error ?? "Couldn't connect through SimpleFIN");
      setToken("");
      setStatus({ ok: true, message: `Connected ${json.accounts} account${json.accounts === 1 ? "" : "s"}.` });
      router.refresh();
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : "Couldn't connect through SimpleFIN" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Connect through SimpleFIN instead</summary>
      <p className="mt-2 text-xs text-slate-500">
        Get a setup token at{" "}
        <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noreferrer" className="underline">
          SimpleFIN Bridge
        </a>{" "}
        (about $15 a year, paid to SimpleFIN), after connecting your banks there. Transactions from the last 90 days
        come in now, then new ones every few hours.
      </p>
      <form onSubmit={submit} className="mt-2 flex flex-wrap gap-2">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Setup token"
          aria-label="SimpleFIN setup token"
          autoComplete="off"
          className="min-w-[260px] flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
        />
        <button
          type="submit"
          disabled={busy || !token.trim()}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </form>
      {status && <p className={`mt-2 ${status.ok ? "text-emerald-700" : "text-red-600"}`}>{status.message}</p>}
    </details>
  );
}

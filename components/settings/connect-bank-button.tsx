"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import {
  errorFrom,
  finishReconnect,
  rememberLinkSession,
  takeLinkSession,
  type PlaidLinkAccount,
  type PlaidLinkMetadata,
} from "./plaid-link-session";

interface PendingLink {
  publicToken: string;
  institutionName?: string;
  institutionId?: string;
  accounts: PlaidLinkAccount[];
}

// resumeOAuth: rendered on /settings/bank-return, where Plaid sends the tab
// back after a bank's own sign-in page — re-opens Link with the remembered
// token so the flow finishes exactly as it would have in the popup.
export function ConnectBankButton({
  organizationId,
  resumeOAuth = false,
  linkableAccounts = [],
}: {
  organizationId: string;
  resumeOAuth?: boolean;
  // Existing asset and liability accounts a bank account can be linked to
  // instead of creating a new one (reconnecting a bank for more history).
  linkableAccounts?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isScriptReady, setIsScriptReady] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [linkedAccounts, setLinkedAccounts] = useState<Record<string, string>>({});

  const openSelection = useCallback((publicToken: string, metadata: PlaidLinkMetadata) => {
    setPendingLink({
      publicToken,
      institutionName: metadata.institution?.name,
      institutionId: metadata.institution?.institution_id,
      accounts: metadata.accounts,
    });
    setSelectedIds(new Set(metadata.accounts.map((account) => account.id)));
    setLinkedAccounts({});
    dialogRef.current?.showModal();
  }, []);

  function toggleAccount(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function cancelSelection() {
    dialogRef.current?.close();
    setPendingLink(null);
  }

  const confirmImport = useCallback(async () => {
    if (!pendingLink || selectedIds.size === 0) return;

    dialogRef.current?.close();
    setIsConnecting(true);
    setStatus(null);

    try {
      const response = await fetch("/api/bank/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicToken: pendingLink.publicToken,
          institutionName: pendingLink.institutionName,
          organizationId,
          selectedAccountIds: Array.from(selectedIds),
          institutionId: pendingLink.institutionId,
          accountMasks: pendingLink.accounts
            .filter((account) => selectedIds.has(account.id))
            .map((account) => account.mask)
            .filter(Boolean),
          linkedAccounts: Object.fromEntries(
            Object.entries(linkedAccounts).filter(([id, ledgerId]) => selectedIds.has(id) && ledgerId),
          ),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to save enrollment");
      }

      setStatus({ type: "success", message: "Bank connected." });
      // /api/bank/enroll is a Route Handler, not a Server Action, so there's
      // no automatic revalidation of the server-rendered enrollments list
      // below — without this it keeps showing "No banks connected yet."
      // until the next unrelated navigation.
      router.refresh();
    } catch (error: unknown) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to connect bank",
      });
    } finally {
      setIsConnecting(false);
      setPendingLink(null);
    }
  }, [linkedAccounts, organizationId, pendingLink, router, selectedIds]);

  async function openLink() {
    if (!isScriptReady || !window.Plaid) {
      setStatus({ type: "error", message: "Plaid Link is not configured" });
      return;
    }

    setIsConnecting(true);
    setStatus(null);

    try {
      const response = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) {
        throw new Error(await errorFrom(response, "Failed to start bank connection"));
      }
      const { linkToken } = (await response.json()) as { linkToken: string };

      rememberLinkSession({ token: linkToken, mode: "connect" });
      window.Plaid.create({ token: linkToken, onSuccess: openSelection }).open();
    } catch (error: unknown) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to start bank connection",
      });
    } finally {
      setIsConnecting(false);
    }
  }

  // Runs once Link's script has loaded on /settings/bank-return.
  function resumeAfterOAuth() {
    if (!window.Plaid) return;
    const session = takeLinkSession();
    if (!session) {
      setStatus({ type: "error", message: "This bank connection expired — please start again." });
      return;
    }

    window.Plaid.create({
      token: session.token,
      receivedRedirectUri: window.location.href,
      onSuccess:
        session.mode === "connect"
          ? openSelection
          : () => {
              void finishReconnect(session.enrollmentId).then((ok) => {
                if (ok) {
                  router.push("/settings");
                } else {
                  setStatus({ type: "error", message: "Reconnected at the bank, but saving that failed." });
                }
              });
            },
    }).open();
  }

  return (
    <div className="flex flex-col gap-2">
      <Script
        src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"
        strategy="afterInteractive"
        onReady={() => {
          setIsScriptReady(true);
          if (resumeOAuth) resumeAfterOAuth();
        }}
      />
      <button
        type="button"
        onClick={() => void openLink()}
        disabled={!isScriptReady || isConnecting}
        className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {isConnecting ? "Connecting…" : "Connect a bank account"}
      </button>
      {status && (
        <p
          className={`text-sm ${status.type === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          {status.message}
        </p>
      )}

      <dialog
        ref={dialogRef}
        className="rounded-lg border border-slate-200 p-0 shadow-lg backdrop:bg-slate-900/40"
      >
        <div className="w-96 p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Choose accounts to import
            {pendingLink?.institutionName ? ` from ${pendingLink.institutionName}` : ""}
          </h2>
          <ul className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
            {pendingLink?.accounts.map((account) => (
              <li key={account.id}>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(account.id)}
                    onChange={() => toggleAccount(account.id)}
                  />
                  <span>
                    {account.name}
                    {account.mask ? ` ••${account.mask}` : ""}
                  </span>
                  <span className="text-xs text-slate-400">
                    ({account.subtype ?? account.type})
                  </span>
                </label>
                {linkableAccounts.length > 0 && selectedIds.has(account.id) && (
                  <select
                    aria-label={`Ledger account for ${account.name}`}
                    value={linkedAccounts[account.id] ?? ""}
                    onChange={(e) => setLinkedAccounts((prev) => ({ ...prev, [account.id]: e.target.value }))}
                    className="ml-6 mt-1 w-[calc(100%-1.5rem)] rounded-md border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">Create a new account</option>
                    {linkableAccounts.map((option) => (
                      <option key={option.id} value={option.id}>
                        Use {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
          {linkableAccounts.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              Reconnecting a bank you removed? Use its existing account: transactions already there
              aren&rsquo;t imported again.
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelSelection}
              className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmImport()}
              disabled={selectedIds.size === 0}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Connect {selectedIds.size} account{selectedIds.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

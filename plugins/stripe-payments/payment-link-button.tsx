// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import { createInvoicePaymentLink, getInvoiceLinkStatus, type InvoiceLinkStatus } from "./actions";

export const PaymentLinkButton: SlotComponent<"invoice.actions"> = ({ context }) => {
  const { invoiceId, status } = context;
  const [linkStatus, setLinkStatus] = useState<InvoiceLinkStatus | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getInvoiceLinkStatus(invoiceId).then(setLinkStatus, () => setLinkStatus(null));
  }, [invoiceId]);

  if (!linkStatus?.canCreate || status === "paid" || status === "void") {
    return linkStatus?.link?.status === "paid" ? <span className="text-xs text-emerald-700">Paid through Stripe</span> : null;
  }

  async function make() {
    setBusy(true);
    setError(null);
    const result = await createInvoicePaymentLink(invoiceId);
    setBusy(false);
    if ("error" in result) setError(result.error);
    else setUrl(result.url ?? null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {url ? (
        <>
          <a href={url} target="_blank" rel="noreferrer" className="max-w-[240px] truncate text-slate-700 underline">
            {url}
          </a>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={make}
          disabled={busy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? "Making link…" : "Payment link"}
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
};

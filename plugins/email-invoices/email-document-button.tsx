// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useRef, useState } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import { useMoney } from "@/components/providers/book-currency-provider";
import { getDocumentMailStatus, sendEstimateEmail, sendStatementEmail, type DocumentMailStatus } from "./documents";

type Sent = { ok: true; message: string } | { error: string };

// A button and a dialog (to, message) that sends one document as text.
function EmailDocumentButton({
  label,
  title,
  defaultTo,
  defaultMessage,
  send,
}: {
  label: string;
  title: string;
  defaultTo: string;
  defaultMessage: string;
  send: (to: string, message: string) => Promise<Sent>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<DocumentMailStatus | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);

  useEffect(() => {
    getDocumentMailStatus().then(setStatus, () => setStatus(null));
  }, []);

  if (!status?.canSend) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setIsSending(true);
    setResult(null);
    try {
      const sent = await send(String(form.get("to") ?? "").trim(), String(form.get("message") ?? ""));
      setResult("error" in sent ? { error: sent.error } : { message: sent.message });
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Couldn't send it" });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={!status.configured}
        title={status.configured ? undefined : "An owner can set up email in Settings"}
        onClick={() => {
          setResult(null);
          dialogRef.current?.showModal();
        }}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 print:hidden"
      >
        {label}
      </button>
      <dialog ref={dialogRef} className="rounded-lg border border-slate-200 p-0 shadow-lg backdrop:bg-slate-900/40">
        <form onSubmit={handleSubmit} className="flex w-[28rem] max-w-full flex-col gap-3 p-5 text-sm">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <label className="flex flex-col gap-1">
            <span className="text-slate-700">To</span>
            <input name="to" type="email" required defaultValue={defaultTo} className="rounded-md border border-slate-300 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-700">Message</span>
            <textarea
              name="message"
              rows={5}
              maxLength={10_000}
              defaultValue={defaultMessage}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <p className="text-xs text-slate-500">The figures are added below your message, as text.</p>
          {result?.error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{result.error}</p>}
          {result?.message && <p className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-800">{result.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
              {result?.message ? "Close" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={isSending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isSending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export const EmailEstimateButton: SlotComponent<"estimate.actions"> = ({ context }) => {
  if (context.status === "invoiced") return null;
  return (
    <EmailDocumentButton
      label="Email estimate"
      title={`Email estimate ${context.estimateNumber}`}
      defaultTo={context.customer?.email ?? ""}
      defaultMessage={`Hello${context.customer ? ` ${context.customer.name}` : ""},\n\nHere is estimate ${context.estimateNumber}.\n\nThank you.`}
      send={(to, message) => sendEstimateEmail(context.estimateId, to, message)}
    />
  );
};

export const EmailStatementButton: SlotComponent<"statement.actions"> = ({ context }) => {
  const formatCurrency = useMoney();
  return (
    <EmailDocumentButton
      label="Email statement"
      title={`Email ${context.customer.name}'s statement`}
      defaultTo={context.customer.email ?? ""}
      defaultMessage={`Hello ${context.customer.name},\n\nHere is your statement: ${formatCurrency(context.amountDue)} due.\n\nThank you.`}
      send={(to, message) => sendStatementEmail(context.customerId, context.start, context.end, to, message)}
    />
  );
};

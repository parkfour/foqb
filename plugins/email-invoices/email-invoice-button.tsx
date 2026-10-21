// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useRef, useState } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import { useBookClock } from "@/components/providers/book-clock-provider";
import { formatTimestamp } from "@/lib/time/book-time";
import { getInvoiceEmailStatus, sendInvoiceEmail, type InvoiceEmailStatus } from "./actions";
import { useMoney } from "@/components/providers/book-currency-provider";

export const EmailInvoiceButton: SlotComponent<"invoice.actions"> = ({ context }) => {
  const formatCurrency = useMoney();
  const { invoiceId, invoiceNumber, customer, remaining, dueDate, status, buildPdf } = context;
  const { timeZone } = useBookClock();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [emailStatus, setEmailStatus] = useState<InvoiceEmailStatus | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);

  useEffect(() => {
    getInvoiceEmailStatus(invoiceId).then(setEmailStatus, () => setEmailStatus(null));
  }, [invoiceId]);

  if (!emailStatus?.canSend || status === "void") return null;

  const defaultMessage = [
    `Hello${customer ? ` ${customer.name}` : ""},`,
    "",
    `Attached is invoice ${invoiceNumber}: ${formatCurrency(remaining)} due${dueDate ? ` by ${dueDate}` : ""}.`,
    "",
    "Thank you.",
  ].join("\n");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setIsSending(true);
    setResult(null);
    try {
      form.set("invoiceId", invoiceId);
      form.set("pdf", await buildPdf());
      const sent = await sendInvoiceEmail(form);
      if ("error" in sent) {
        setResult({ error: sent.error });
      } else {
        setResult({ message: sent.message });
        getInvoiceEmailStatus(invoiceId).then(setEmailStatus, () => {});
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Couldn't send the invoice" });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={!emailStatus.configured}
        title={emailStatus.configured ? undefined : "An owner can set up email in Settings"}
        onClick={() => {
          setResult(null);
          dialogRef.current?.showModal();
        }}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Email invoice
      </button>
      <dialog
        ref={dialogRef}
        className="rounded-lg border border-slate-200 p-0 shadow-lg backdrop:bg-slate-900/40"
      >
        <form onSubmit={handleSubmit} className="flex w-[28rem] max-w-full flex-col gap-3 p-5 text-sm">
          <h2 className="font-semibold text-slate-900">Email invoice {invoiceNumber}</h2>
          {emailStatus.lastSent && (
            <p className="text-xs text-slate-500">
              Last sent to {emailStatus.lastSent.to} on {formatTimestamp(emailStatus.lastSent.at, timeZone)}.
            </p>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-slate-700">To</span>
            <input
              name="to"
              type="email"
              required
              defaultValue={customer?.email ?? ""}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-700">Subject</span>
            <input
              name="subject"
              required
              maxLength={200}
              defaultValue={`Invoice ${invoiceNumber}`}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-700">Message</span>
            <textarea
              name="message"
              rows={6}
              maxLength={10_000}
              defaultValue={defaultMessage}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <p className="text-xs text-slate-500">The invoice is attached as a PDF.</p>
          {result?.error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{result.error}</p>}
          {result?.message && <p className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-800">{result.message}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
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
};

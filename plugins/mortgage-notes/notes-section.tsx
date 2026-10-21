// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useEffect, useState } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import {
  bookPayments,
  createNote,
  deleteNote,
  get1098,
  getNoteForEdit,
  getNotes,
  updateNote,
  type Form1098Report,
  type NoteInput,
  type NoteSummary,
} from "./actions";
import { levelPayment } from "./schedule";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs";

const FIELDS: { name: string; label: string; type?: string; placeholder?: string; required?: boolean }[] = [
  { name: "name", label: "Note name", placeholder: "e.g. Elm St mortgage", required: true },
  { name: "borrowerName", label: "Borrower", required: true },
  { name: "matchText", label: "Name on their bank payments", placeholder: "as it shows in the register", required: true },
  { name: "borrowerAddress", label: "Borrower's address" },
  { name: "borrowerTin", label: "Borrower's SSN or TIN" },
  { name: "propertyAddress", label: "Property securing the loan" },
  { name: "lenderName", label: "Lender (you), as on the 1098" },
  { name: "lenderAddress", label: "Lender's address" },
  { name: "lenderTin", label: "Lender's SSN or TIN" },
  { name: "originalPrincipal", label: "Original principal ($)", type: "number", required: true },
  { name: "annualRate", label: "Interest rate (%)", type: "number", required: true },
  { name: "termMonths", label: "Term (months)", type: "number", required: true },
  { name: "originationDate", label: "Date the loan was made", type: "date", required: true },
  { name: "firstPaymentDate", label: "First payment due", type: "date", required: true },
  { name: "paymentAmount", label: "Monthly principal and interest ($)", type: "number" },
  { name: "escrowAmount", label: "Monthly escrow ($, if any)", type: "number" },
  { name: "balanceAsOf", label: "Books take it up on", type: "date", required: true },
  { name: "balance", label: "Owed that day ($, blank: by the schedule)", type: "number" },
];

function noteInput(form: FormData): NoteInput {
  const text = (k: string) => String(form.get(k) ?? "");
  const num = (k: string) => Number.parseFloat(text(k));
  const principal = num("originalPrincipal");
  const rate = num("annualRate");
  const term = Number.parseInt(text("termMonths"), 10);
  return {
    name: text("name"),
    borrowerName: text("borrowerName"),
    borrowerAddress: text("borrowerAddress"),
    borrowerTin: text("borrowerTin"),
    lenderName: text("lenderName"),
    lenderAddress: text("lenderAddress"),
    lenderTin: text("lenderTin"),
    propertyAddress: text("propertyAddress"),
    originationDate: text("originationDate"),
    originalPrincipal: principal,
    annualRate: rate,
    termMonths: term,
    firstPaymentDate: text("firstPaymentDate"),
    paymentAmount: text("paymentAmount") ? num("paymentAmount") : levelPayment(principal, rate, term),
    escrowAmount: text("escrowAmount") ? num("escrowAmount") : 0,
    matchText: text("matchText"),
    balanceAsOf: text("balanceAsOf"),
    balance: text("balance") ? num("balance") : null,
  };
}

// Editing: the note's id, what the form starts with, and the stored
// taxpayer ids' last 4 (blank keeps them).
interface Editing {
  id: string;
  values: Record<string, string>;
  borrowerTinLast4: string | null;
  lenderTinLast4: string | null;
}

function boxRow(label: string, value: string) {
  return `<tr><th style="text-align:left;padding:4px 12px 4px 0;font-weight:normal">${label}</th><td style="padding:4px 0">${value}</td></tr>`;
}

const escape = (s: string | null) =>
  (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// The borrower's statement, in a window of its own to print.
function printStatement(r: Form1098Report) {
  const html = `<!doctype html><meta charset="utf-8"><title>Mortgage interest statement ${r.year}</title>
<body style="font-family:system-ui,sans-serif;font-size:14px;max-width:640px;margin:32px auto">
<h1 style="font-size:18px">Mortgage Interest Statement (Form 1098 information), ${r.year}</h1>
<table>
${boxRow("Recipient/lender", `${escape(r.lender.name)}<br>${escape(r.lender.address)}<br>TIN ${escape(r.lender.tin)}`)}
${boxRow("Payer/borrower", `${escape(r.borrower.name)}<br>${escape(r.borrower.address)}<br>TIN ${escape(r.borrower.tin)}`)}
${boxRow("1. Mortgage interest received from payer/borrower", formatCurrency(r.interestReceived))}
${boxRow("2. Outstanding mortgage principal", formatCurrency(r.principalOutstanding))}
${boxRow("3. Mortgage origination date", r.originationDate)}
${boxRow("8. Address of property securing mortgage", escape(r.propertyAddress))}
${boxRow("Principal received in " + r.year, formatCurrency(r.principalReceived))}
${r.escrowReceived || r.escrowPaidOut ? boxRow("Escrow received / paid out", `${formatCurrency(r.escrowReceived)} / ${formatCurrency(r.escrowPaidOut)}`) : ""}
</table>
<p style="font-size:12px;color:#555">The IRS copy (Copy A) is filed on the official form or electronically, not on this page.</p>
</body>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const MortgageNotesSection: SlotComponent<"properties.sections"> = ({ context }) => {
  const { organizationId } = context;
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [report, setReport] = useState<Form1098Report | null>(null);

  const load = useCallback(() => getNotes(organizationId).then(setNotes), [organizationId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!context.canWrite || notes === null) return null;

  const tinPlaceholder = (name: string) => {
    const last4 = name === "borrowerTin" ? editing?.borrowerTinLast4 : name === "lenderTin" ? editing?.lenderTinLast4 : null;
    return last4 ? `••${last4} (blank keeps it)` : null;
  };

  async function handleSave(form: FormData) {
    setBusy(true);
    const result = editing
      ? await updateNote(organizationId, editing.id, noteInput(form))
      : await createNote(organizationId, noteInput(form));
    setBusy(false);
    if (!result.success) return setMessage(result.error);
    setMessage(
      editing
        ? `Note saved; ${result.booked ?? 0} payments booked on the new terms` +
            (result.kept ? `, ${result.kept} reconciled ones kept as they were.` : ".")
        : `Note added; ${result.booked ?? 0} waiting payments booked.`,
    );
    setAdding(false);
    setEditing(null);
    load();
  }

  async function handleEdit(id: string) {
    const note = await getNoteForEdit(organizationId, id);
    if (!note) return setMessage("Couldn't open that note");
    setAdding(false);
    setEditing({ id, ...note });
  }

  async function handleBook(id: string) {
    const result = await bookPayments(organizationId, id);
    setMessage(result.success ? `${result.booked ?? 0} waiting payments booked.` : result.error);
    load();
  }

  async function handleDelete(note: NoteSummary) {
    const result = await deleteNote(organizationId, note.id);
    setMessage(result.success ? `${note.name} removed; its accounts and entries stay.` : result.error);
    load();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <h2 className="text-base font-semibold text-slate-900">Mortgage Notes You Hold</h2>
        <button
          type="button"
          onClick={() => {
            setAdding(!(adding || editing));
            setEditing(null);
          }}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {adding || editing ? "Cancel" : "+ Add note"}
        </button>
      </div>
      <p className="px-6 pt-3 text-xs text-slate-500">
        A deposit naming the borrower is booked as their payment: the month&rsquo;s interest, then escrow, then
        principal. Other deposits (a renter&rsquo;s, say) go to your rules as usual.
      </p>
      {message && (
        <p role="status" className="px-6 pt-2 text-xs text-slate-700">
          {message}
        </p>
      )}

      {(adding || editing) && (
        <form
          key={editing?.id ?? "new"}
          action={handleSave}
          className="grid grid-cols-1 gap-3 px-6 py-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {editing && (
            <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">
              Saving re-books the opening balance and splits the borrower&rsquo;s payments again on these terms.
            </p>
          )}
          {FIELDS.map((f) => (
            <label key={f.name} className="text-xs font-medium text-slate-700">
              {f.label}
              <input
                name={f.name}
                type={f.type ?? "text"}
                step={f.type === "number" ? "any" : undefined}
                required={f.required}
                defaultValue={editing?.values[f.name]}
                placeholder={tinPlaceholder(f.name) ?? f.placeholder}
                className={input}
              />
            </label>
          ))}
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Saving…" : editing ? "Save note" : "Add note"}
            </button>
          </div>
        </form>
      )}

      {notes.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">No notes yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th className="px-6 py-3">Note</th>
                <th className="px-6 py-3">Borrower</th>
                <th className="px-6 py-3 text-right">Rate</th>
                <th className="px-6 py-3 text-right">Payment</th>
                <th className="px-6 py-3 text-right">Owed</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {notes.map((n) => (
                <tr key={n.id}>
                  <td className="px-6 py-3 font-semibold text-slate-900">{n.name}</td>
                  <td className="px-6 py-3 text-xs text-slate-600">
                    {n.borrowerName}
                    {n.borrowerTinLast4 && <span className="text-slate-400"> · TIN ••{n.borrowerTinLast4}</span>}
                    <br />
                    <span className="text-slate-400">matches &ldquo;{n.matchText}&rdquo;</span>
                  </td>
                  <td className="px-6 py-3 text-right font-mono">{n.annualRate}%</td>
                  <td className="px-6 py-3 text-right font-mono">
                    {formatCurrency(n.paymentAmount)}
                    {n.escrowAmount > 0 && <span className="text-slate-400"> + {formatCurrency(n.escrowAmount)}</span>}
                  </td>
                  <td className="px-6 py-3 text-right font-mono font-bold">{formatCurrency(n.balance)}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="inline-flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={async () => setReport(await get1098(organizationId, n.id, year))}
                        className="rounded border border-slate-200 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
                      >
                        1098
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEdit(n.id)}
                        className="rounded border border-slate-200 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBook(n.id)}
                        className="rounded border border-slate-200 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Book waiting payments
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(n)}
                        className="rounded px-2 py-1 font-medium text-rose-700 hover:bg-rose-50"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-6 py-3 text-xs text-slate-600">
        <label htmlFor="notes-1098-year">Tax year</label>
        <input
          id="notes-1098-year"
          type="number"
          value={year}
          onChange={(e) => {
            setYear(Number(e.target.value));
            setReport(null);
          }}
          className="w-20 rounded border border-slate-300 px-2 py-1"
        />
      </div>

      {report && (
        <div className="border-t border-slate-100 px-6 py-4 text-xs text-slate-800">
          <h3 className="text-sm font-semibold">
            {report.note}: Form 1098, {report.year}
          </h3>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            <dt>1. Mortgage interest received</dt>
            <dd className="font-mono">{formatCurrency(report.interestReceived)}</dd>
            <dt>2. Outstanding principal</dt>
            <dd className="font-mono">{formatCurrency(report.principalOutstanding)}</dd>
            <dt>3. Origination date</dt>
            <dd className="font-mono">{report.originationDate}</dd>
            <dt>8. Property address</dt>
            <dd>{report.propertyAddress ?? "—"}</dd>
            <dt>Principal received</dt>
            <dd className="font-mono">{formatCurrency(report.principalReceived)}</dd>
            {(report.escrowReceived > 0 || report.escrowPaidOut > 0) && (
              <>
                <dt>Escrow received / paid out (box 10, if reported)</dt>
                <dd className="font-mono">
                  {formatCurrency(report.escrowReceived)} / {formatCurrency(report.escrowPaidOut)}
                </dd>
              </>
            )}
          </dl>
          <p className="mt-2 text-slate-500">
            Box 1 is also this borrower&rsquo;s line on your Schedule B, Part I.
          </p>
          <button
            type="button"
            onClick={() => printStatement(report)}
            className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800"
          >
            Borrower&rsquo;s statement to print
          </button>
        </div>
      )}
    </div>
  );
};

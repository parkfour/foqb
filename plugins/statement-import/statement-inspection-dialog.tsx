// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import type { DocumentInspection } from "./inspect";
import { useMoney } from "@/components/providers/book-currency-provider";

// What the reader found, to show why a statement didn't read and to help
// write a reader for its layout. Nothing is imported from here: rows picked
// off loose text have no sign, year or balance check to trust.
interface StatementInspectionDialogProps {
  inspection: DocumentInspection;
  // Why the statement couldn't be imported, from the reader.
  reason: string;
  onClose: () => void;
}

const CATEGORY_STYLES: Record<string, string> = {
  date: "bg-blue-50 text-blue-700 border-blue-200",
  amount: "bg-emerald-50 text-emerald-700 border-emerald-200",
  account: "bg-purple-50 text-purple-700 border-purple-200",
  balance: "bg-amber-50 text-amber-700 border-amber-200",
  institution: "bg-slate-100 text-slate-700 border-slate-200",
  transaction: "bg-indigo-50 text-indigo-700 border-indigo-200",
  description: "bg-cyan-50 text-cyan-700 border-cyan-200",
  section: "bg-rose-50 text-rose-700 border-rose-200",
};

export function StatementInspectionDialog({
  inspection,
  reason,
  onClose,
}: StatementInspectionDialogProps) {
  const formatCurrency = useMoney();
  const [activeTab, setActiveTab] = useState<"tagged" | "candidates">("tagged");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-800">
                Fallback Inspection
              </span>
              <h2 className="text-base font-semibold text-slate-900">
                Document Structure & Recognized Entities
              </h2>
            </div>
            <p role="alert" className="mt-1 text-xs font-medium text-red-700">
              {reason}
            </p>
            <p className="mt-1 text-xs text-slate-500">Here is what was identified on the imported document:</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Identified Metadata Badges */}
        <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-white p-4 sm:grid-cols-4 text-xs">
          <div className="flex flex-col gap-0.5 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
            <span className="text-[10px] font-medium uppercase text-slate-400">Detected Bank</span>
            <span className="font-semibold text-slate-800">
              {inspection.detectedBank ?? "Unknown / Unlisted"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
            <span className="text-[10px] font-medium uppercase text-slate-400">Account #</span>
            <span className="font-semibold text-slate-800">
              {inspection.detectedAccountLast4 ? `•••• ${inspection.detectedAccountLast4}` : "Not Found"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
            <span className="text-[10px] font-medium uppercase text-slate-400">Period</span>
            <span className="font-semibold text-slate-800">
              {inspection.detectedPeriod
                ? `${inspection.detectedPeriod.start} - ${inspection.detectedPeriod.end}`
                : "Not Found"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg border border-slate-100 bg-slate-50 p-2.5">
            <span className="text-[10px] font-medium uppercase text-slate-400">Balances Found</span>
            <span className="font-semibold text-slate-800">
              {inspection.openingBalance !== null ? formatCurrency(inspection.openingBalance) : "—"} /{" "}
              {inspection.closingBalance !== null ? formatCurrency(inspection.closingBalance) : "—"}
            </span>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex border-b border-slate-200 px-6 pt-2 bg-slate-50/50">
          <button
            onClick={() => setActiveTab("tagged")}
            className={`border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
              activeTab === "tagged"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Tagged Document Lines ({inspection.taggedLines.length})
          </button>
          <button
            onClick={() => setActiveTab("candidates")}
            className={`border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
              activeTab === "candidates"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Candidate Transactions ({inspection.candidateTransactions.length})
          </button>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "tagged" ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 pb-2 text-[11px] text-slate-500">
                <span>Legend:</span>
                <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700">
                  Date
                </span>
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                  Amount
                </span>
                <span className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-purple-700">
                  Account #
                </span>
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700">
                  Balance
                </span>
                <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-indigo-700">
                  Candidate Row
                </span>
                <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-700">
                  Institution
                </span>
              </div>

              {inspection.taggedLines.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">
                  No recognizable entity patterns found in the document text.
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white font-mono text-xs">
                  {inspection.taggedLines.map((line) => (
                    <div
                      key={line.lineNumber}
                      className={`flex flex-col gap-1.5 p-3 hover:bg-slate-50/80 transition-colors ${
                        line.isTransactionCandidate ? "bg-indigo-50/20" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-sans mr-1">
                          L{line.lineNumber}
                        </span>
                        {line.tags.map((t, idx) => (
                          <span
                            key={idx}
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-sans font-medium ${
                              CATEGORY_STYLES[t.category] ?? "bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {t.tag}: {t.text}
                          </span>
                        ))}
                      </div>
                      <p className="text-slate-800 break-all pl-6 text-[11px] leading-relaxed">
                        {line.rawText}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <p>
                  Found {inspection.candidateTransactions.length} lines that look like transactions.
                  They can&rsquo;t be imported from here: the statement needs a reader that adds up to its
                  closing balance.
                </p>
              </div>

              {inspection.candidateTransactions.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-400">
                  No candidate transactions could be isolated from document rows.
                </p>
              ) : (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-[11px] font-medium uppercase text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="p-3">Detected Date</th>
                        <th className="p-3">Extracted Description</th>
                        <th className="p-3 text-right">Detected Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {inspection.candidateTransactions.map((tx) => {
                        return (
                          <tr key={tx.id} className="hover:bg-slate-50/50">
                            <td className="p-3 font-mono text-[11px] text-slate-600">
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 border border-blue-200">
                                {tx.date}
                              </span>
                            </td>
                            <td className="p-3 text-slate-900">{tx.description}</td>
                            <td
                              className={`p-3 text-right font-mono ${
                                tx.amount < 0 ? "text-slate-900" : "text-emerald-700"
                              }`}
                            >
                              {formatCurrency(tx.amount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs">
          <span className="text-slate-400">
            Total lines parsed from document: {inspection.rawLinesCount}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            Close Analysis
          </button>
        </div>
      </div>
    </div>
  );
}

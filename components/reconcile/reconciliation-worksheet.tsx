"use client";

import { useMemo, useState } from "react";
import { finishReconciliation } from "@/app/(dashboard)/reconcile/actions";
import { signedAmount, type ReconciliationLine } from "@/lib/reconcile/shared";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function ReconciliationWorksheet({
  reconciliationId,
  organizationId,
  accountType,
  beginningBalance,
  statementEndingBalance,
  lines,
  canWrite,
}: {
  reconciliationId: string;
  organizationId: string;
  accountType: string;
  beginningBalance: number;
  statementEndingBalance: number;
  lines: ReconciliationLine[];
  canWrite: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const clearedTotal = useMemo(
    () =>
      lines
        .filter((line) => selected.has(line.id))
        .reduce((sum, line) => sum + signedAmount(accountType, line.debit, line.credit), 0),
    [lines, selected, accountType],
  );

  const difference = Math.round((statementEndingBalance - (beginningBalance + clearedTotal)) * 100) / 100;
  const isBalanced = Math.abs(difference) < 0.005;
  const allChecked = lines.length > 0 && lines.every((l) => selected.has(l.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <form action={finishReconciliation} className="flex flex-col gap-4">
      <input type="hidden" name="reconciliationId" value={reconciliationId} />
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-100 sm:grid-cols-4">
        <div className="bg-white px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Beginning Balance</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {formatCurrency(beginningBalance)}
          </p>
        </div>
        <div className="bg-white px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Cleared Total</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(clearedTotal)}</p>
        </div>
        <div className="bg-white px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Statement Ending Balance</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {formatCurrency(statementEndingBalance)}
          </p>
        </div>
        <div className="bg-white px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Difference</p>
          <p className={`mt-1 text-lg font-semibold ${isBalanced ? "text-emerald-700" : "text-red-600"}`}>
            {formatCurrency(difference)}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="w-10 px-5 py-3">
                  {lines.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Check all"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(lines.map((l) => l.id)))}
                      disabled={!canWrite}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  )}
                </th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Memo</th>
                <th className="px-5 py-3 text-right font-medium">Debit</th>
                <th className="px-5 py-3 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No uncleared transactions on or before this statement date.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        name="lineIds"
                        value={line.id}
                        checked={selected.has(line.id)}
                        onChange={() => toggle(line.id)}
                        disabled={!canWrite}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <td className="px-5 py-3 text-slate-600">{line.entryDate}</td>
                    <td className="px-5 py-3 text-slate-900">
                      {line.description || line.memo || "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {line.debit > 0 ? formatCurrency(line.debit) : ""}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {line.credit > 0 ? formatCurrency(line.credit) : ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canWrite && (
        <button
          type="submit"
          disabled={!isBalanced}
          className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Finish Reconciliation
        </button>
      )}
    </form>
  );
}

// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { VatSummary } from "./summary";

export function VatSummaryTable({ summary, money }: { summary: VatSummary; money: (n: number) => string }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {summary.byRate.map((r) => (
          <tr key={`${r.name}${r.rate}`}>
            <td className="py-1">
              {r.name}: sales {money(r.net)}
            </td>
            <td className="py-1 text-right">{money(r.vat)}</td>
          </tr>
        ))}
        <tr className="border-t border-slate-200 font-medium">
          <td className="py-1">VAT charged (output)</td>
          <td className="py-1 text-right">{money(summary.outputVat)}</td>
        </tr>
        <tr>
          <td className="py-1">VAT paid on purchases (input)</td>
          <td className="py-1 text-right">-{money(summary.inputVat)}</td>
        </tr>
        <tr className="border-t border-slate-300 font-semibold">
          <td className="py-1">{summary.due >= 0 ? "Due" : "To reclaim"}</td>
          <td className="py-1 text-right">{money(Math.abs(summary.due))}</td>
        </tr>
        <tr className="text-slate-600">
          <td className="py-1">Reverse-charge supplies to EU businesses (no VAT)</td>
          <td className="py-1 text-right">{money(summary.reverseCharge)}</td>
        </tr>
        <tr className="text-slate-600">
          <td className="py-1">Other sales without VAT</td>
          <td className="py-1 text-right">{money(summary.noVat)}</td>
        </tr>
      </tbody>
    </table>
  );
}

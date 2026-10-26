// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import type { PluginReportContext } from "@/lib/plugins/types";
import { useMoney } from "@/components/providers/book-currency-provider";
import { getVatSummary } from "./actions";
import type { VatSummary } from "./summary";
import { VatSummaryTable } from "./vat-summary-table";

// The VAT summary under Financial Reports.
export function VatReport({ context }: { context: PluginReportContext }) {
  const money = useMoney();
  const [result, setResult] = useState<{ summary?: VatSummary; error?: string } | null>(null);
  const { organizationId, start, end } = context;

  useEffect(() => {
    getVatSummary(organizationId, start, end).then(
      (r) => setResult(r.ok ? { summary: r.value } : { error: r.error }),
      (err) => setResult({ error: String(err) }),
    );
  }, [organizationId, start, end]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">VAT summary: {start} to {end}</h2>
      <p className="mb-3 text-xs text-amber-800">A starting point only: check every return with your tax adviser.</p>
      {result?.error && <p className="text-sm text-red-700">{result.error}</p>}
      {result?.summary ? <VatSummaryTable summary={result.summary} money={money} /> : !result && <p className="text-sm text-slate-500">Loading…</p>}
    </div>
  );
}

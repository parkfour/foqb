// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import type { PluginReportContext } from "@/lib/plugins/types";
import { useMoney } from "@/components/providers/book-currency-provider";
import { getPayrollReports, getPayrollSetup, type PayrollReports } from "./actions";
import { PayrollForms } from "./payroll-forms";

// The year's draft 941, 940 and W-2 figures under Financial Reports, for
// the year of the as-of date.
export function PayrollReport({ context }: { context: PluginReportContext }) {
  const money = useMoney();
  const year = Number(context.asOf.slice(0, 4));
  const [data, setData] = useState<{ reports?: PayrollReports; names?: Map<string, string>; error?: string } | null>(null);

  useEffect(() => {
    Promise.all([getPayrollReports(context.organizationId, year), getPayrollSetup(context.organizationId)]).then(
      ([r, s]) =>
        setData(
          r.ok && s.ok
            ? { reports: r.value, names: new Map(s.value.employees.map((e) => [e.id, e.name])) }
            : { error: !r.ok ? r.error : !s.ok ? s.error : "" },
        ),
      (err) => setData({ error: String(err) }),
    );
  }, [context.organizationId, year]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Payroll forms, {year} (draft)</h2>
      <p className="mb-3 text-xs text-amber-800">Draft figures only: check every form with your tax professional before filing.</p>
      {data?.error && <p className="text-sm text-red-700">{data.error}</p>}
      {data?.reports ? (
        <PayrollForms reports={data.reports} money={money} nameOf={(id) => data.names?.get(id) ?? "—"} />
      ) : (
        !data && <p className="text-sm text-slate-500">Loading…</p>
      )}
    </div>
  );
}

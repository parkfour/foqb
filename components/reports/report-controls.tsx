"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { RANGE_REPORTS } from "./report-types";
import type { PluginReportOption } from "@/lib/plugins/pages";

const REPORT_TYPES = [
  { value: "trial-balance", label: "Trial Balance" },
  { value: "income-statement", label: "Income Statement (P&L)" },
  { value: "income-statement-by-class", label: "Profit & Loss by Class" },
  { value: "balance-sheet", label: "Balance Sheet" },
  { value: "cash-flow-statement", label: "Statement of Cash Flows" },
  { value: "general-ledger", label: "General Ledger" },
  { value: "foreign-balances", label: "Foreign Currency Balances" },
  { value: "ar-aging", label: "AR Aging" },
  { value: "ap-aging", label: "AP Aging" },
  { value: "tax-line-items", label: "Tax Line Report" },
  { value: "sales-tax", label: "Sales Tax" },
  { value: "1099-nec", label: "1099-NEC" },
] as const;

export function ReportControls({
  report,
  asOf,
  start,
  end,
  year,
  pluginReports = [],
}: {
  report: string;
  asOf: string;
  start: string;
  end: string;
  year: number;
  pluginReports?: PluginReportOption[];
}) {
  const router = useRouter();
  const [selectedReport, setSelectedReport] = useState(report);
  const isRange = RANGE_REPORTS.has(selectedReport) || pluginReports.some((r) => r.value === selectedReport && r.range);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    params.set("report", selectedReport);

    if (selectedReport === "1099-nec") {
      params.set("year", formData.get("year") as string);
    } else if (isRange) {
      params.set("start", formData.get("start") as string);
      params.set("end", formData.get("end") as string);
    } else {
      params.set("asOf", formData.get("asOf") as string);
    }

    router.push(`/reports?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="report" className="text-xs font-medium text-slate-600">
          Report
        </label>
        <select
          id="report"
          name="report"
          value={selectedReport}
          onChange={(e) => setSelectedReport(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {REPORT_TYPES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
          {pluginReports.length > 0 && (
            <optgroup label="From plugins">
              {pluginReports.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {selectedReport === "1099-nec" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="year" className="text-xs font-medium text-slate-600">
            Year
          </label>
          <input
            type="number"
            id="year"
            name="year"
            min="2000"
            max="2100"
            defaultValue={year}
            className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      ) : isRange ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="start" className="text-xs font-medium text-slate-600">
              Start Date
            </label>
            <input
              type="date"
              id="start"
              name="start"
              defaultValue={start}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="end" className="text-xs font-medium text-slate-600">
              End Date
            </label>
            <input
              type="date"
              id="end"
              name="end"
              defaultValue={end}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="asOf" className="text-xs font-medium text-slate-600">
            As Of Date
          </label>
          <input
            type="date"
            id="asOf"
            name="asOf"
            defaultValue={asOf}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      )}

      <button
        type="submit"
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Run Report
      </button>
    </form>
  );
}

"use client";

import { useState, useSyncExternalStore } from "react";
import { useBookCurrency, useMoney } from "@/components/providers/book-currency-provider";

function noopSubscribe() {
  return () => {};
}

// Always false during SSR and the first client render (hydration), true on
// every render after — the sanctioned way to gate client-only content
// without the setState-in-an-effect cascading-render pattern.
function useHasMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export interface MonthComparison {
  month: string;
  thisYearIncome: number;
  thisYearExpense: number;
  lastYearIncome: number;
  lastYearExpense: number;
}

function formatAxisLabel(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

const SERIES = [
  { key: "thisYearIncome", label: "This Year Income", color: "#0f172a" },
  { key: "thisYearExpense", label: "This Year Expense", color: "#94a3b8" },
  { key: "lastYearIncome", label: "Last Year Income", color: "#059669" },
  { key: "lastYearExpense", label: "Last Year Expense", color: "#fca5a5" },
] as const;

function BarChart({ data }: { data: MonthComparison[] }) {
  const currency = useBookCurrency();
  const formatCurrency = useMoney();
  // React's SSR hoists any <title> element it finds anywhere in the tree as
  // document-head metadata, including this one nested deep inside an SVG
  // <rect> for a native hover tooltip — not the document title it looks
  // like from the tag name alone. That strips its text server-side (a real,
  // verified bug: every one of these renders empty in the SSR HTML), which
  // then mismatches the client's real content and forces React to re-render
  // the whole subtree. Rendering it only after mount makes the server and
  // the first client pass agree (neither renders it), and adds the tooltip
  // moments later as an ordinary post-hydration update instead.
  const mounted = useHasMounted();

  const width = 800;
  const height = 280;
  const paddingLeft = 72;
  const paddingBottom = 24;
  const chartWidth = width - paddingLeft - 8;
  const chartHeight = height - paddingBottom - 8;

  const maxValue = Math.max(1, ...data.flatMap((row) => SERIES.map((s) => row[s.key])));
  const monthBandWidth = chartWidth / data.length;
  const barWidth = (monthBandWidth * 0.7) / SERIES.length;
  const groupGap = monthBandWidth * 0.15;

  function yFor(value: number): number {
    return chartHeight - (value / maxValue) * chartHeight;
  }

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Year-over-year income and expense chart" className="w-full">
        <g transform={`translate(${paddingLeft}, 8)`}>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1={0}
                x2={chartWidth}
                y1={chartHeight * (1 - fraction)}
                y2={chartHeight * (1 - fraction)}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text x={-8} y={chartHeight * (1 - fraction)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#64748b">
                {formatAxisLabel(maxValue * fraction, currency)}
              </text>
            </g>
          ))}

          {data.map((row, monthIndex) => {
            const groupX = monthIndex * monthBandWidth + groupGap / 2;
            return (
              <g key={row.month}>
                {SERIES.map((series, seriesIndex) => {
                  const value = row[series.key];
                  const barHeight = chartHeight - yFor(value);
                  return (
                    <rect
                      key={series.key}
                      x={groupX + seriesIndex * barWidth}
                      y={yFor(value)}
                      width={Math.max(barWidth - 1, 0)}
                      height={Math.max(barHeight, 0)}
                      fill={series.color}
                    >
                      {mounted && (
                        <title>
                          {row.month} {series.label}: {formatCurrency(value)}
                        </title>
                      )}
                    </rect>
                  );
                })}
                <text
                  x={monthIndex * monthBandWidth + monthBandWidth / 2}
                  y={chartHeight + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#64748b"
                >
                  {row.month}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="flex flex-wrap gap-4">
        {SERIES.map((series) => (
          <div key={series.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series.color }} />
            {series.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparisonTable({ data }: { data: MonthComparison[] }) {
  const formatCurrency = useMoney();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2 font-medium">Month</th>
            <th className="px-3 py-2 font-medium">This Year Income</th>
            <th className="px-3 py-2 font-medium">This Year Expense</th>
            <th className="px-3 py-2 font-medium">This Year Net</th>
            <th className="px-3 py-2 font-medium">Last Year Income</th>
            <th className="px-3 py-2 font-medium">Last Year Expense</th>
            <th className="px-3 py-2 font-medium">Last Year Net</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.month} className="border-b border-slate-100 last:border-0">
              <td className="px-3 py-2 text-slate-900">{row.month}</td>
              <td className="px-3 py-2 text-slate-600">{formatCurrency(row.thisYearIncome)}</td>
              <td className="px-3 py-2 text-slate-600">{formatCurrency(row.thisYearExpense)}</td>
              <td className="px-3 py-2 text-slate-600">
                {formatCurrency(row.thisYearIncome - row.thisYearExpense)}
              </td>
              <td className="px-3 py-2 text-slate-600">{formatCurrency(row.lastYearIncome)}</td>
              <td className="px-3 py-2 text-slate-600">{formatCurrency(row.lastYearExpense)}</td>
              <td className="px-3 py-2 text-slate-600">
                {formatCurrency(row.lastYearIncome - row.lastYearExpense)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function YoyComparison({
  data,
  thisYear,
  lastYear,
}: {
  data: MonthComparison[];
  thisYear: number;
  lastYear: number;
}) {
  const [view, setView] = useState<"graph" | "table">("graph");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">
          {thisYear} vs {lastYear}: Income &amp; Expenses
        </h2>
        <select
          value={view}
          onChange={(e) => setView(e.target.value as "graph" | "table")}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="graph">Graph</option>
          <option value="table">Table</option>
        </select>
      </div>
      <div className="mt-4">
        {view === "graph" ? <BarChart data={data} /> : <ComparisonTable data={data} />}
      </div>
    </div>
  );
}

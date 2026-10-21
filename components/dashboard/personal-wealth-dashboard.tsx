"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Building, Home, Landmark, LineChart, Wallet } from "lucide-react";
import type { NetWorthBucket, NetWorthSnapshotData } from "@/lib/net-worth/engine";
import { BreakdownDialog, type Breakdown, type BreakdownLine } from "./breakdown-dialog";

interface WealthDashboardProps {
  data: NetWorthSnapshotData;
  history: { date: string; net_worth: number; total_assets: number; total_liabilities: number }[];
  businessEquity?: {
    total: number;
    businesses: { id: string; name: string; equity: number }[];
  };
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

export function PersonalWealthDashboard({
  data,
  history,
  businessEquity,
}: WealthDashboardProps) {
  const [timeframe, setTimeframe] = useState<"1M" | "6M" | "1Y" | "ALL">("1Y");
  const [includeBusiness, setIncludeBusiness] = useState(false);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);

  // Filter history based on timeframe
  const filteredHistory = useMemo(() => {
    if (history.length === 0) {
      return [{ date: data.date, net_worth: data.netWorth, total_assets: data.totalAssets, total_liabilities: data.totalLiabilities }];
    }
    const baseTime = new Date(data.date).getTime();
    let days = 365;
    if (timeframe === "1M") days = 30;
    else if (timeframe === "6M") days = 180;
    else if (timeframe === "ALL") return history;

    const cutoff = new Date(baseTime - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const subset = history.filter((h) => h.date >= cutoff);
    return subset.length > 0 ? subset : history.slice(-5);
  }, [history, timeframe, data]);

  const effectiveBusinessEquity = includeBusiness ? (businessEquity?.total ?? 0) : 0;
  const currentAssets = data.totalAssets + effectiveBusinessEquity;
  const currentNetWorth = currentAssets - data.totalLiabilities;
  const delta = data.thirtyDayDelta ?? 0;

  // What's behind each figure, for its popup.
  const items = data.items ?? [];
  const linesIn = (...buckets: NetWorthBucket[]): BreakdownLine[] =>
    items.filter((i) => buckets.includes(i.bucket)).map(({ name, amount, href }) => ({ name, amount, href }));
  const businessLines: BreakdownLine[] = includeBusiness
    ? (businessEquity?.businesses ?? []).map((b) => ({ name: `${b.name} (business equity)`, amount: b.equity }))
    : [];
  const assetLines = [...linesIn("cash", "investments", "real_estate", "vehicles"), ...businessLines];
  const liabilityLines = linesIn("credit_cards", "mortgages", "loans", "other_liabilities");
  const show = (title: string, total: number, lines: BreakdownLine[]) => setBreakdown({ title, total, sections: [{ lines }] });
  const showAssets = () => show("Total Assets", currentAssets, assetLines);
  const showLiabilities = () => show("Total Liabilities", data.totalLiabilities, liabilityLines);
  const showNetWorth = () =>
    setBreakdown({
      title: "Total Net Worth",
      total: currentNetWorth,
      sections: [
        { heading: `Assets ${formatCurrency(currentAssets)}`, lines: assetLines },
        { heading: `Liabilities ${formatCurrency(data.totalLiabilities)}`, lines: liabilityLines },
      ],
    });

  // Chart min/max scaling
  const chartPoints = useMemo(() => {
    if (filteredHistory.length === 0) return [];
    const values = filteredHistory.map((h) => h.net_worth);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return filteredHistory.map((h, i) => {
      const x = filteredHistory.length > 1 ? (i / (filteredHistory.length - 1)) * 100 : 50;
      const y = 100 - ((h.net_worth - min) / range) * 80 - 10; // 10% padding top/bottom
      return { x, y, ...h };
    });
  }, [filteredHistory]);

  const svgPath = useMemo(() => {
    if (chartPoints.length === 0) return "";
    if (chartPoints.length === 1) return `M 0,${chartPoints[0].y} L 100,${chartPoints[0].y}`;
    return chartPoints.reduce((acc, pt, i) => `${acc} ${i === 0 ? "M" : "L"} ${pt.x},${pt.y}`, "");
  }, [chartPoints]);

  return (
    <div className="flex flex-col gap-6">
      {/* Total Net Worth Banner */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <button type="button" onClick={showNetWorth} className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Net Worth
            </span>
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                delta >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
              }`}
            >
              {delta >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {delta >= 0 ? "+" : ""}
              {formatCurrency(delta)} (30d)
            </span>
          </div>
          <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
            {formatCurrency(currentNetWorth)}
          </p>
          <p className="mt-1 text-xs text-slate-400">As of today</p>
        </button>

        <button type="button" onClick={showAssets} className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Assets
          </span>
          <p className="mt-3 text-3xl font-extrabold tracking-tight text-emerald-600">
            {formatCurrency(currentAssets)}
          </p>
          <p className="mt-1 text-xs text-slate-400">Cash, investments & real estate</p>
        </button>

        <button type="button" onClick={showLiabilities} className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Liabilities
          </span>
          <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-700">
            {formatCurrency(data.totalLiabilities)}
          </p>
          <p className="mt-1 text-xs text-slate-400">Mortgages, credit cards & loans</p>
        </button>
      </div>

      {/* Interactive Net Worth Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Net Worth Trajectory</h2>
            <p className="text-xs text-slate-500">Historical net worth snapshots</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-1 bg-slate-50 text-xs font-medium">
            {(["1M", "6M", "1Y", "ALL"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTimeframe(t)}
                className={`rounded px-2.5 py-1 transition-colors ${
                  timeframe === t
                    ? "bg-white font-semibold text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {t === "ALL" ? "All-time" : t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 h-56 w-full">
          <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="gradientNetWorth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0284c7" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {svgPath && (
              <>
                <path
                  d={`${svgPath} L 100,100 L 0,100 Z`}
                  fill="url(#gradientNetWorth)"
                  stroke="none"
                />
                <path
                  d={svgPath}
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
            {/* A zero-length round-capped stroke, not a <circle>: the chart
                stretches to fit (preserveAspectRatio="none"), which would
                squash circles into ellipses; a non-scaling stroke stays round. */}
            {chartPoints.map((pt, i) => (
              <path
                key={i}
                d={`M ${pt.x},${pt.y} l 0,0`}
                stroke="#0284c7"
                strokeWidth="8"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${pt.date}: ${formatCurrency(pt.net_worth)}`}</title>
              </path>
            ))}
          </svg>
        </div>

        <div className="mt-4 flex items-center justify-between text-[11px] text-slate-400">
          <span>{filteredHistory[0]?.date || "Past"}</span>
          <span>{filteredHistory[filteredHistory.length - 1]?.date || "Today"}</span>
        </div>
      </div>

      {/* Asset Allocation & Debt Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Assets Breakdown */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <button
            type="button"
            onClick={showAssets}
            className="flex w-full items-center justify-between border-b border-slate-100 pb-3 text-left hover:opacity-80"
          >
            <h3 className="text-sm font-semibold text-slate-900">Asset Allocation</h3>
            <span className="font-mono text-sm font-bold text-emerald-600">
              {formatCurrency(currentAssets)}
            </span>
          </button>

          <div className="mt-4 flex flex-col gap-3">
            <button type="button" onClick={() => show("Cash & Equivalents", data.breakdown.cash, linesIn("cash"))} className="flex w-full items-center justify-between rounded-lg bg-slate-50 p-3 text-left hover:bg-slate-100">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-blue-100 p-2 text-blue-700">
                  <Wallet className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-800">Cash & Equivalents</p>
                  <p className="text-[11px] text-slate-500">Checking, savings & money market</p>
                </div>
              </div>
              <span className="font-mono text-xs font-bold text-slate-900">
                {formatCurrency(data.breakdown.cash)}
              </span>
            </button>

            <button type="button" onClick={() => show("Brokerage & Investments", data.breakdown.investments, linesIn("investments"))} className="flex w-full items-center justify-between rounded-lg bg-slate-50 p-3 text-left hover:bg-slate-100">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-indigo-100 p-2 text-indigo-700">
                  <LineChart className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-800">Brokerage & Investments</p>
                  <p className="text-[11px] text-slate-500">Brokerage & retirement account balances</p>
                </div>
              </div>
              <span className="font-mono text-xs font-bold text-slate-900">
                {formatCurrency(data.breakdown.investments)}
              </span>
            </button>

            <button type="button" onClick={() => show("Real Estate", data.breakdown.real_estate, linesIn("real_estate"))} className="flex w-full items-center justify-between rounded-lg bg-slate-50 p-3 text-left hover:bg-slate-100">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-amber-100 p-2 text-amber-700">
                  <Home className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-800">Real Estate</p>
                  <p className="text-[11px] text-slate-500">Properties, at the values you entered</p>
                </div>
              </div>
              <span className="font-mono text-xs font-bold text-slate-900">
                {formatCurrency(data.breakdown.real_estate)}
              </span>
            </button>

            {data.breakdown.vehicles > 0 && (
              <button type="button" onClick={() => show("Vehicles & Other", data.breakdown.vehicles, linesIn("vehicles"))} className="flex w-full items-center justify-between rounded-lg bg-slate-50 p-3 text-left hover:bg-slate-100">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-purple-100 p-2 text-purple-700">
                    <Landmark className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">Vehicles & Other</p>
                    <p className="text-[11px] text-slate-500">Automobiles & physical assets</p>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-slate-900">
                  {formatCurrency(data.breakdown.vehicles)}
                </span>
              </button>
            )}

            {includeBusiness && effectiveBusinessEquity > 0 && (
              <button
                type="button"
                onClick={() => show("Business Equity Roll-Up", effectiveBusinessEquity, businessLines)}
                className="flex w-full items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-left hover:bg-emerald-100"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-emerald-100 p-2 text-emerald-800">
                    <Building className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-emerald-950">Business Equity Roll-Up</p>
                    <p className="text-[11px] text-emerald-700">Consolidated small business book equity</p>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-emerald-900">
                  {formatCurrency(effectiveBusinessEquity)}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Debt Breakdown */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <button
            type="button"
            onClick={showLiabilities}
            className="flex w-full items-center justify-between border-b border-slate-100 pb-3 text-left hover:opacity-80"
          >
            <h3 className="text-sm font-semibold text-slate-900">Debt & Liabilities</h3>
            <span className="font-mono text-sm font-bold text-rose-600">
              {formatCurrency(data.totalLiabilities)}
            </span>
          </button>

          <div className="mt-4 flex flex-col gap-3">
            <button type="button" onClick={() => show("Credit Cards", data.breakdown.credit_cards, linesIn("credit_cards"))} className="flex w-full items-center justify-between rounded-lg bg-slate-50 p-3 text-left hover:bg-slate-100">
              <div>
                <p className="text-xs font-semibold text-slate-800">Credit Cards</p>
                <p className="text-[11px] text-slate-500">Revolving balances</p>
              </div>
              <span className="font-mono text-xs font-bold text-slate-900">
                {formatCurrency(data.breakdown.credit_cards)}
              </span>
            </button>

            <button type="button" onClick={() => show("Mortgages", data.breakdown.mortgages, linesIn("mortgages"))} className="flex w-full items-center justify-between rounded-lg bg-slate-50 p-3 text-left hover:bg-slate-100">
              <div>
                <p className="text-xs font-semibold text-slate-800">Mortgages</p>
                <p className="text-[11px] text-slate-500">Primary & property loans</p>
              </div>
              <span className="font-mono text-xs font-bold text-slate-900">
                {formatCurrency(data.breakdown.mortgages)}
              </span>
            </button>

            <button type="button" onClick={() => show("Other Loans & Debt", data.breakdown.loans + (data.breakdown.other_liabilities ?? 0), linesIn("loans", "other_liabilities"))} className="flex w-full items-center justify-between rounded-lg bg-slate-50 p-3 text-left hover:bg-slate-100">
              <div>
                <p className="text-xs font-semibold text-slate-800">Other Loans & Debt</p>
                <p className="text-[11px] text-slate-500">Auto, personal & student loans</p>
              </div>
              <span className="font-mono text-xs font-bold text-slate-900">
                {formatCurrency(data.breakdown.loans + (data.breakdown.other_liabilities ?? 0))}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Business Equity Roll-Up (Optional Cross-Entity View) */}
      {businessEquity && businessEquity.businesses.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Business Equity Roll-Up (Cross-Entity View)
              </h3>
              <p className="text-xs text-slate-500">
                Book equity (assets &minus; liabilities) of the businesses you own in FOQB. Each counts in full, not by your ownership share.
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={includeBusiness}
                onChange={(e) => setIncludeBusiness(e.target.checked)}
                className="rounded border-slate-300 text-slate-900"
              />
              Include in Net Worth
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {businessEquity.businesses.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 bg-slate-50/50">
                <div>
                  <p className="text-xs font-bold text-slate-900">{b.name}</p>
                  <p className="text-[11px] text-slate-500">Book equity</p>
                </div>
                <span className="font-mono text-xs font-bold text-emerald-700">
                  {formatCurrency(b.equity)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <BreakdownDialog breakdown={breakdown} onClose={() => setBreakdown(null)} />
    </div>
  );
}

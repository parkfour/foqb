// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import { useMoney } from "@/components/providers/book-currency-provider";
import { getPropertyValuesView, refreshPropertyValues, saveNoteBase, type ActionResult, type ValuesRow, type ValuesView } from "./actions";
import { quarterLabel } from "./fhfa";
import type { Estimate, ValueSource } from "./server";

export const FRED_NOTICE = "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";
export const FRED_TERMS_URL = "https://fred.stlouisfed.org/docs/api/terms_of_use.html";

function NoteBaseForm({ organizationId, row, onSaved }: { organizationId: string; row: ValuesRow; onSaved: (r: ActionResult) => void }) {
  const [pending, start] = useTransition();
  return (
    <form
      className="flex items-center gap-1"
      action={(form) =>
        start(async () => {
          const text = String(form.get("value") ?? "").trim();
          onSaved(await saveNoteBase(organizationId, row.id, text ? Number.parseFloat(text) : null));
        })
      }
    >
      <input
        name="value"
        type="number"
        step="0.01"
        min="0"
        defaultValue={row.base ?? ""}
        placeholder="Value when made"
        aria-label={`${row.name}: the property's value when the loan was made`}
        className="w-32 rounded border border-slate-200 px-2 py-1 text-xs font-mono"
      />
      <button type="submit" disabled={pending} className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        Save
      </button>
    </form>
  );
}

const SOURCE_NAMES: Record<ValueSource, string> = {
  fhfa: "house price index value",
  rentcast: "RentCast estimate",
  zillow: "Zillow estimate",
};

function EstimateCell({ estimate, format }: { estimate: Estimate | null | undefined; format: (n: number) => string }) {
  return (
    <td className="px-6 py-3 text-right font-mono">
      {estimate ? (
        <>
          {format(estimate.value)}
          {estimate.low && estimate.high && (
            <p className="text-xs text-slate-500">
              {format(estimate.low)}–{format(estimate.high)}
            </p>
          )}
          <p className="text-xs text-slate-500">as of {estimate.asOf.slice(0, 10)}</p>
        </>
      ) : (
        <span className="text-xs text-slate-400">—</span>
      )}
    </td>
  );
}

export const PropertyValuesSection: SlotComponent<"properties.sections"> = ({ context }) => {
  const { organizationId, revision } = context;
  const formatCurrency = useMoney();
  const [view, setView] = useState<ValuesView | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const load = useCallback(() => {
    getPropertyValuesView(organizationId).then(setView, () => setView(null));
  }, [organizationId]);
  // Again whenever the page is: a property or note added, changed or removed.
  useEffect(load, [load, revision]);

  if (!view || view.rows.length === 0) return null;
  const after = (r: ActionResult) => {
    setResult(r);
    load();
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Property values</h2>
          <p className="mt-1 text-xs text-slate-500">
            Each property side by side: what was paid moved with FHFA&rsquo;s house price index for the area (changes
            quarterly){view.hasRentcastKey && ", RentCast's estimate from nearby sales (weekly)"}
            {view.showZillow && ", a Zillow estimate"}.
            {view.autoUpdate && ` Each property's estimated value is replaced weekly with the ${SOURCE_NAMES[view.source]}.`}
          </p>
        </div>
        {view.canWrite && (
          <button
            type="button"
            disabled={refreshing}
            onClick={() => startRefresh(async () => after(await refreshPropertyValues(organizationId)))}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh values"}
          </button>
        )}
      </div>

      {(!view.hasFredKey || !view.hasRentcastKey) && (
        <p className="border-b border-slate-100 px-6 py-3 text-xs text-amber-800">
          {!view.hasFredKey && "No FRED API key yet (house price index). "}
          {!view.hasRentcastKey && "No RentCast API key (market estimate). "}
          An owner adds them under Settings → Plugins → Property values.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-6 py-3">Property</th>
              <th className="px-6 py-3 text-right">Paid / value when made</th>
              <th className="px-6 py-3 text-right">Index value</th>
              <th className="px-6 py-3">Index</th>
              {view.hasRentcastKey && <th className="px-6 py-3 text-right">RentCast estimate</th>}
              {view.showZillow && <th className="px-6 py-3 text-right">Zillow estimate</th>}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => {
              const fhfa = row.valuation?.fhfa;
              return (
                <tr key={`${row.kind}:${row.id}`} className="border-b border-slate-100 last:border-0">
                  <td className="px-6 py-3">
                    <p className="font-medium text-slate-900">{row.name}</p>
                    <p className="text-xs text-slate-500">{row.kind === "note" ? "Securing a mortgage note" : "Property"}</p>
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-xs">
                    {row.kind === "note" && view.canWrite ? (
                      <NoteBaseForm organizationId={organizationId} row={row} onSaved={after} />
                    ) : row.base ? (
                      formatCurrency(row.base)
                    ) : (
                      <span className="text-slate-400">No purchase price</span>
                    )}
                    {row.baseDate && <p className="mt-0.5 text-slate-500">{row.baseDate}</p>}
                  </td>
                  <td className="px-6 py-3 text-right font-mono">
                    {fhfa ? formatCurrency(fhfa.value) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                  <td className="px-6 py-3 text-xs text-slate-600">
                    {fhfa ? (
                      <>
                        <p>{fhfa.index}</p>
                        <p className="text-slate-500">
                          {quarterLabel(fhfa.from)} {fhfa.fromIndex} → {quarterLabel(fhfa.to)} {fhfa.toIndex}
                        </p>
                      </>
                    ) : row.base && row.baseDate ? (
                      <span className="text-slate-400">Not valued yet (or bought in a quarter FHFA hasn&rsquo;t published)</span>
                    ) : (
                      <span className="text-slate-400">Needs {row.kind === "note" ? "the value when the loan was made" : "a purchase price and date"}</span>
                    )}
                  </td>
                  {view.hasRentcastKey && <EstimateCell estimate={row.valuation?.rentcast} format={formatCurrency} />}
                  {view.showZillow && <EstimateCell estimate={row.valuation?.zillow} format={formatCurrency} />}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1 border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
        {result && "error" in result && <p className="text-red-700">{result.error}</p>}
        {result && "ok" in result && result.message && <p className="text-emerald-800">{result.message}</p>}
        {view.refreshedAt && <p>Last valued {new Date(view.refreshedAt).toLocaleString()}.</p>}
        {view.rentcast && (
          <p>
            RentCast lookups this month: {view.rentcast.used} of {view.rentcast.limit}.
          </p>
        )}
        <p>
          FHFA all-transactions house price index, quarterly, not seasonally adjusted. Addresses are sent to the US Census
          Bureau&rsquo;s geocoder to find the area. {FRED_NOTICE}{" "}
          <a href={FRED_TERMS_URL} target="_blank" rel="noreferrer" className="underline">
            FRED API terms of use
          </a>
          .
        </p>
      </div>
    </div>
  );
};

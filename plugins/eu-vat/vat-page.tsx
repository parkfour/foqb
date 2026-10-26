// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState, useTransition } from "react";
import type { PluginPageContext } from "@/lib/plugins/types";
import { useMoney } from "@/components/providers/book-currency-provider";
import { useBookToday } from "@/components/providers/book-clock-provider";
import { EU_STANDARD_RATES } from "./rates";
import type { VatSummary } from "./summary";
import { VatSummaryTable } from "./vat-summary-table";
import { addVatRate, getVatSetup, getVatSummary, saveVatSetup, type VatSetup } from "./actions";

const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const card = "rounded-lg border border-slate-200 bg-white p-5 shadow-sm";

export function VatPage({ context }: { context: PluginPageContext }) {
  const orgId = context.organizationId;
  const money = useMoney();
  const today = useBookToday();
  const [setup, setSetup] = useState<VatSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [rateName, setRateName] = useState("");
  const [rate, setRate] = useState("");
  const quarterStart = `${today.slice(0, 5)}${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  const [start, setStart] = useState(quarterStart);
  const [end, setEnd] = useState(today);
  const [summary, setSummary] = useState<VatSummary | null>(null);

  const load = () =>
    startTransition(async () => {
      const r = await getVatSetup(orgId);
      if (r.ok) setSetup(r.value);
      else setError(r.error);
    });
  useEffect(load, [orgId]);

  if (!setup) return <p className="text-sm text-slate-500">{error ?? "Loading VAT…"}</p>;
  const s = setup.settings;
  const set = (patch: Partial<typeof s>) => setSetup({ ...setup, settings: { ...s, ...patch } });
  const standard = s.country ? EU_STANDARD_RATES[s.country] : null;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed");
      else {
        setNotice(done);
        load();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-sm font-medium text-amber-950">
        A starting point only. Check rates, invoices and every return with your tax adviser: this doesn&apos;t file
        anything, check VAT numbers with VIES, or handle OSS, imports, distance-selling thresholds or your country&apos;s
        return boxes.
      </div>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section className={card}>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Your VAT registration</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Country
            <select value={s.country} onChange={(e) => set({ country: e.target.value })} className={input}>
              <option value="">Choose…</option>
              {Object.entries(EU_STANDARD_RATES).map(([code, c]) => (
                <option key={code} value={code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            VAT number
            <input value={s.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} className={input} />
          </label>
          {(
            [
              ["outputAccountId", "VAT charged on sales (a liability)", "liability"],
              ["inputAccountId", "VAT paid on purchases, to reclaim (an asset)", "asset"],
            ] as const
          ).map(([key, label, type]) => (
            <label key={key} className="flex flex-col gap-1 text-xs text-slate-600">
              {label}
              <select value={s[key]} onChange={(e) => set({ [key]: e.target.value })} className={input}>
                <option value="">Choose…</option>
                {setup.accounts
                  .filter((a) => a.type === type)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_number} {a.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>

        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase text-slate-500">Reverse-charge customers</h3>
        <p className="mb-2 text-xs text-slate-500">
          VAT-registered businesses in another EU country. Invoice them without VAT; the invoice should say
          &quot;Reverse charge&quot;. They&apos;re shown apart in the summary.
        </p>
        <table className="text-sm">
          <tbody>
            {setup.customers.map((c) => {
              const rc = setup.reverseCharge[c.id];
              return (
                <tr key={c.id}>
                  <td className="pr-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!rc}
                        onChange={(e) => {
                          const next = { ...setup.reverseCharge };
                          if (e.target.checked) next[c.id] = { vatNumber: "" };
                          else delete next[c.id];
                          setSetup({ ...setup, reverseCharge: next });
                        }}
                      />
                      {c.name}
                    </label>
                  </td>
                  <td>
                    {rc && (
                      <input
                        placeholder="Their VAT number"
                        value={rc.vatNumber}
                        onChange={(e) => setSetup({ ...setup, reverseCharge: { ...setup.reverseCharge, [c.id]: { vatNumber: e.target.value } } })}
                        className={input}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {context.canWrite && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => saveVatSetup(orgId, setup.settings, setup.reverseCharge), "Saved.")}
            className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-1 text-sm font-semibold text-slate-900">VAT rates</h2>
        <p className="mb-3 text-xs text-slate-500">
          Each is a sales tax rate (Settings → Sales tax) crediting the output VAT account; tick it on an invoice.
        </p>
        <ul className="mb-3 text-sm text-slate-700">
          {setup.rates.map((r) => (
            <li key={r.id} className={r.is_active ? "" : "text-slate-400"}>
              {r.name}: {Number(r.rate)}%
            </li>
          ))}
        </ul>
        {context.canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            {standard && !setup.rates.some((r) => Number(r.rate) === standard.rate) && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => addVatRate(orgId, `VAT ${standard.rate}% (${s.country})`, standard.rate), "Standard rate added.")}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                Add {standard.name}&apos;s standard rate ({standard.rate}%)
              </button>
            )}
            <input placeholder="Reduced rate name" value={rateName} onChange={(e) => setRateName(e.target.value)} className={input} />
            <input type="number" step="0.01" min="0" placeholder="%" value={rate} onChange={(e) => setRate(e.target.value)} className={`${input} w-20`} />
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => addVatRate(orgId, rateName, Number(rate)), "Rate added.")}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              Add rate
            </button>
          </div>
        )}
      </section>

      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">VAT summary</h2>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await getVatSummary(orgId, start, end);
                if (r.ok) setSummary(r.value);
                else setError(r.error);
              })
            }
            className="rounded-md border border-slate-300 px-3 py-1 text-sm"
          >
            Show
          </button>
        </div>
        {summary && (
          <VatSummaryTable summary={summary} money={money} />
        )}
      </section>
    </div>
  );
}

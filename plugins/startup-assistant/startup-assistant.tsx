// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useCallback, useEffect, useState } from "react";
import type { SlotComponent } from "@/lib/plugins/types";
import { cleanUpStartup, finishStartup, getStartup, startBudget, type Startup } from "./actions";

const button = "rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50";

export const StartupAssistant: SlotComponent<"reconcile.header"> = () => {
  const [startup, setStartup] = useState<Startup | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // All done, for a household: the starting-budget question and its months.
  const [asking, setAsking] = useState<{ from: string; to: string } | null>(null);

  const load = useCallback(() => getStartup().then(setStartup), []);
  useEffect(() => {
    load();
  }, [load]);

  if (startup === null) return null;
  const { accounts } = startup;
  const toClean = accounts.reduce((n, a) => n + a.earlyEntries + a.earlyRows, 0);

  async function handleCleanUp() {
    setBusy(true);
    const result = await cleanUpStartup();
    setBusy(false);
    if (!result.success) return setMessage(result.error);
    const { moved, kept, ignored } = result.value;
    setMessage(
      `${moved} entries moved to equity, ${ignored} older feed rows set aside` +
        (kept ? `; ${kept} couldn't be (a locked period?) and are left for you.` : "."),
    );
    load();
  }

  async function finish() {
    const result = await finishStartup();
    if (!result.success) return setMessage(result.error);
    setStartup(null);
  }

  async function handleBudget() {
    if (!asking) return;
    setBusy(true);
    const result = await startBudget(asking.from, asking.to);
    setBusy(false);
    if (!result.success) return setMessage(result.error);
    await finish();
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-slate-800">
      <h2 className="text-sm font-semibold text-slate-900">Start-up assistant</h2>
      <p className="mt-1 text-xs text-slate-600">
        Each account&rsquo;s opening balance already holds everything dated on or before it. Until you&rsquo;re done,
        nothing can be booked to an account that early: another account&rsquo;s old transfer to it goes to equity.
      </p>
      {accounts.length > 0 && (
        <table className="mt-3 w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Account</th>
              <th className="py-1 pr-3 font-medium">Opening balance on</th>
              <th className="py-1 text-right font-medium">From before it</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.accountId} className="border-t border-amber-100">
                <td className="py-1 pr-3">{a.name}</td>
                <td className="py-1 pr-3 font-mono">{a.startsOn}</td>
                <td className="py-1 text-right font-mono">
                  {a.earlyEntries + a.earlyRows === 0
                    ? "—"
                    : `${a.earlyEntries} booked, ${a.earlyRows} waiting`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs text-slate-700">
          {message}
        </p>
      )}
      {asking ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-white p-3 text-xs">
          <p className="font-medium text-slate-900">Start a budget from your average spending, or no budget?</p>
          <p className="mt-1 text-slate-600">
            Each expense category gets its average monthly spending over these months, budgeted the same in each
            of them. Months you&rsquo;ve already budgeted are left as they are. If you like it, open the month after
            these on the Budget page and click Copy Last Month.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor="startup-budget-from">From</label>
            <input
              id="startup-budget-from"
              type="month"
              value={asking.from}
              onChange={(e) => setAsking({ ...asking, from: e.target.value })}
              className="rounded border border-slate-300 px-2 py-1"
            />
            <label htmlFor="startup-budget-to">to</label>
            <input
              id="startup-budget-to"
              type="month"
              value={asking.to}
              onChange={(e) => setAsking({ ...asking, to: e.target.value })}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleBudget}
              disabled={busy || !asking.from || !asking.to}
              className={`${button} bg-slate-900 text-white hover:bg-slate-800`}
            >
              {busy ? "Budgeting…" : "Average spending"}
            </button>
            <button
              type="button"
              onClick={finish}
              disabled={busy}
              className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            >
              No budget
            </button>
            <button type="button" onClick={() => setAsking(null)} disabled={busy} className={`${button} text-slate-500`}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleCleanUp}
            disabled={busy || toClean === 0}
            className={`${button} bg-slate-900 text-white hover:bg-slate-800`}
          >
            {busy ? "Cleaning up…" : "Clean up"}
          </button>
          <button
            type="button"
            onClick={() => (startup.budget ? setAsking(startup.budget) : finish())}
            className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
          >
            All done
          </button>
        </div>
      )}
    </section>
  );
};

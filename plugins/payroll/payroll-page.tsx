// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState, useTransition } from "react";
import type { PluginPageContext } from "@/lib/plugins/types";
import { useMoney } from "@/components/providers/book-currency-provider";
import { useBookToday } from "@/components/providers/book-clock-provider";
import { PayrollForms } from "./payroll-forms";
import type { Employee, Paycheck, PayrollAccounts } from "./calc";
import {
  getAccountOptions,
  getPayrollReports,
  getPayrollSetup,
  previewPayroll,
  runPayroll,
  savePayrollSetup,
  type AccountOption,
  type PayrollReports,
  type PayrollSetup,
} from "./actions";

const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";
const card = "rounded-lg border border-slate-200 bg-white p-5 shadow-sm";

const newEmployee = (): Employee => ({
  id: crypto.randomUUID(),
  name: "",
  payFrequency: "biweekly",
  payType: "salary",
  payRate: 0,
  filingStatus: "single",
  step2Checked: false,
  step3Credits: 0,
  step4aOtherIncome: 0,
  step4bDeductions: 0,
  step4cExtra: 0,
  exemptFromFederal: false,
  stateRate: 0,
  localRate: 0,
  active: true,
});

const ACCOUNT_FIELDS: { key: keyof PayrollAccounts; label: string; type: string }[] = [
  { key: "cash", label: "Pay from (cash)", type: "asset" },
  { key: "wages", label: "Wages expense", type: "expense" },
  { key: "employerTaxes", label: "Employer payroll taxes expense", type: "expense" },
  { key: "federalPayable", label: "Federal income tax withheld", type: "liability" },
  { key: "ficaPayable", label: "Social Security and Medicare owed", type: "liability" },
  { key: "futaPayable", label: "Federal unemployment (FUTA) owed", type: "liability" },
  { key: "statePayable", label: "State income tax withheld", type: "liability" },
  { key: "sutaPayable", label: "State unemployment (SUTA) owed", type: "liability" },
  { key: "localPayable", label: "Local tax withheld", type: "liability" },
];

export function PayrollPage({ context }: { context: PluginPageContext }) {
  const orgId = context.organizationId;
  const money = useMoney();
  const today = useBookToday();
  const [setup, setSetup] = useState<PayrollSetup | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [payDate, setPayDate] = useState(today);
  const [gross, setGross] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<(Paycheck & { employeeId: string })[] | null>(null);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [reports, setReports] = useState<PayrollReports | null>(null);

  useEffect(() => {
    startTransition(async () => {
      const [s, a] = await Promise.all([getPayrollSetup(orgId), getAccountOptions(orgId)]);
      if (!s.ok) return setError(s.error);
      setSetup(s.value);
      if (a.ok) setAccounts(a.value);
    });
  }, [orgId]);

  useEffect(() => {
    startTransition(async () => {
      const r = await getPayrollReports(orgId, year);
      if (r.ok) setReports(r.value);
    });
  }, [orgId, year, notice]);

  if (!setup) return <p className="text-sm text-slate-500">{error ?? "Loading payroll…"}</p>;
  const nameOf = (id: string) => setup.employees.find((e) => e.id === id)?.name ?? "—";
  const updateEmployee = (id: string, patch: Partial<Employee>) =>
    setSetup({ ...setup, employees: setup.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed");
      else setNotice(done);
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-sm font-medium text-amber-950">
        A starting point only. Check every paycheck, deposit and form with your tax professional: this doesn&apos;t
        file or pay anything, and doesn&apos;t handle pre-tax deductions, tips, benefits or state rules beyond a flat rate.
      </div>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section className={card}>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Employees (from each Form W-4)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="p-1">Name</th>
                <th className="p-1">Paid</th>
                <th className="p-1">Pay</th>
                <th className="p-1">Filing status</th>
                <th className="p-1">Step 2</th>
                <th className="p-1">3: credits/yr</th>
                <th className="p-1">4a/yr</th>
                <th className="p-1">4b/yr</th>
                <th className="p-1">4c/check</th>
                <th className="p-1">State %</th>
                <th className="p-1">Local %</th>
                <th className="p-1">Active</th>
              </tr>
            </thead>
            <tbody>
              {setup.employees.map((e) => (
                <tr key={e.id}>
                  <td className="p-1">
                    <input value={e.name} onChange={(ev) => updateEmployee(e.id, { name: ev.target.value })} className={`${input} w-32`} />
                  </td>
                  <td className="p-1">
                    <select value={e.payFrequency} onChange={(ev) => updateEmployee(e.id, { payFrequency: ev.target.value as Employee["payFrequency"] })} className={input}>
                      <option value="weekly">weekly</option>
                      <option value="biweekly">every 2 weeks</option>
                      <option value="semimonthly">twice a month</option>
                      <option value="monthly">monthly</option>
                    </select>
                  </td>
                  <td className="p-1 whitespace-nowrap">
                    <select value={e.payType} onChange={(ev) => updateEmployee(e.id, { payType: ev.target.value as Employee["payType"] })} className={input}>
                      <option value="salary">per check</option>
                      <option value="hourly">per hour</option>
                    </select>
                    <input type="number" min="0" step="0.01" value={e.payRate} onChange={(ev) => updateEmployee(e.id, { payRate: num(ev.target.value) })} className={`${input} ml-1 w-24`} />
                  </td>
                  <td className="p-1">
                    <select value={e.filingStatus} onChange={(ev) => updateEmployee(e.id, { filingStatus: ev.target.value as Employee["filingStatus"] })} className={input}>
                      <option value="single">single / separately</option>
                      <option value="married">married jointly</option>
                      <option value="head">head of household</option>
                    </select>
                  </td>
                  <td className="p-1 text-center">
                    <input type="checkbox" checked={e.step2Checked} onChange={(ev) => updateEmployee(e.id, { step2Checked: ev.target.checked })} />
                  </td>
                  {(["step3Credits", "step4aOtherIncome", "step4bDeductions", "step4cExtra", "stateRate", "localRate"] as const).map((k) => (
                    <td key={k} className="p-1">
                      <input type="number" min="0" step="0.01" value={e[k]} onChange={(ev) => updateEmployee(e.id, { [k]: num(ev.target.value) })} className={`${input} w-20`} />
                    </td>
                  ))}
                  <td className="p-1 text-center">
                    <input type="checkbox" checked={e.active} onChange={(ev) => updateEmployee(e.id, { active: ev.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setSetup({ ...setup, employees: [...setup.employees, newEmployee()] })} className="mt-2 text-sm text-slate-600 underline">
          + Add employee
        </button>

        <h2 className="mb-3 mt-6 text-sm font-semibold text-slate-900">Accounts and state unemployment</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ACCOUNT_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-xs text-slate-600">
              {f.label}
              <select
                value={setup.accounts?.[f.key] ?? ""}
                onChange={(ev) => setSetup({ ...setup, accounts: { ...(setup.accounts ?? ({} as PayrollAccounts)), [f.key]: ev.target.value } })}
                className={input}
              >
                <option value="">Choose…</option>
                {accounts
                  .filter((a) => a.type === f.type)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_number} {a.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            SUTA rate (%)
            <input type="number" min="0" step="0.001" value={setup.employer.sutaRate} onChange={(ev) => setSetup({ ...setup, employer: { ...setup.employer, sutaRate: num(ev.target.value) } })} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            SUTA wage base (per employee, per year)
            <input type="number" min="0" step="1" value={setup.employer.sutaWageBase} onChange={(ev) => setSetup({ ...setup, employer: { ...setup.employer, sutaWageBase: num(ev.target.value) } })} className={input} />
          </label>
        </div>
        {context.canWrite && (
          <button type="button" disabled={pending} onClick={() => act(() => savePayrollSetup(orgId, setup), "Saved.")} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Save employees and accounts
          </button>
        )}
      </section>

      {context.canWrite && (
        <section className={card}>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Run payroll</h2>
          <label className="flex items-center gap-2 text-sm">
            Pay date <input type="date" value={payDate} onChange={(ev) => setPayDate(ev.target.value)} className={input} />
          </label>
          <table className="mt-3 text-sm">
            <tbody>
              {setup.employees
                .filter((e) => e.active)
                .map((e) => (
                  <tr key={e.id}>
                    <td className="pr-3">{e.name}</td>
                    <td className="pr-3 text-xs text-slate-500">{e.payType === "hourly" ? `hours at ${money(e.payRate)}` : "gross pay"}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={gross[e.id] ?? (e.payType === "salary" ? String(e.payRate) : "")}
                        onChange={(ev) => setGross({ ...gross, [e.id]: ev.target.value })}
                        className={`${input} w-28`}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {(() => {
            const amounts = Object.fromEntries(
              setup.employees
                .filter((e) => e.active)
                .map((e) => {
                  const entered = num(gross[e.id] ?? (e.payType === "salary" ? String(e.payRate) : "0"));
                  return [e.id, e.payType === "hourly" ? Math.round(entered * e.payRate * 100) / 100 : entered];
                }),
            );
            return (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await previewPayroll(orgId, payDate, amounts);
                      if (r.ok) setPreview(r.value);
                      else setError(r.error);
                    })
                  }
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  Preview
                </button>
                {preview && preview.length > 0 && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      act(async () => {
                        const r = await runPayroll(orgId, payDate, amounts);
                        setPreview(null);
                        return r;
                      }, "Payroll posted.")
                    }
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Post {preview.length} paycheck{preview.length === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            );
          })()}
          {preview && (
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  {["Employee", "Gross", "Federal", "Soc. Sec.", "Medicare", "State", "Local", "Net", "Employer taxes"].map((h) => (
                    <th key={h} className="p-1">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.employeeId}>
                    <td className="p-1">{nameOf(p.employeeId)}</td>
                    <td className="p-1">{money(p.gross)}</td>
                    <td className="p-1">{money(p.federal)}</td>
                    <td className="p-1">{money(p.socialSecurity)}</td>
                    <td className="p-1">{money(p.medicare + p.additionalMedicare)}</td>
                    <td className="p-1">{money(p.state)}</td>
                    <td className="p-1">{money(p.local)}</td>
                    <td className="p-1 font-medium">{money(p.net)}</td>
                    <td className="p-1">{money(p.employerSocialSecurity + p.employerMedicare + p.futa + p.suta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className={card}>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Draft figures for the federal forms</h2>
          <input type="number" value={year} onChange={(ev) => setYear(Number(ev.target.value))} className={`${input} w-24`} aria-label="Year" />
        </div>
        {reports && (
          <PayrollForms reports={reports} money={money} nameOf={nameOf} />
        )}
      </section>
    </div>
  );
}

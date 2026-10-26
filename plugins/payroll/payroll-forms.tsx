// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PayrollReports } from "./actions";

// Draft Form 941, 940 and W-2 figures for a year.
export function PayrollForms({
  reports,
  money,
  nameOf,
}: {
  reports: PayrollReports;
  money: (n: number) => string;
  nameOf: (employeeId: string) => string;
}) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <table className="w-full">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="p-1">Form 941</th>
            {["Q1", "Q2", "Q3", "Q4"].map((q) => (
              <th key={q} className="p-1 text-right">
                {q}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["1 Employees paid", "employees"],
              ["2 Wages", "line2Wages"],
              ["3 Federal income tax withheld", "line3Withheld"],
              ["5a Social Security wages", "line5aSocialSecurityWages"],
              ["5a tax (12.4%)", "line5aTax"],
              ["5c Medicare wages", "line5cMedicareWages"],
              ["5c tax (2.9%)", "line5cTax"],
              ["5d Additional Medicare wages", "line5dAdditionalMedicareWages"],
              ["5d tax (0.9%)", "line5dTax"],
              ["6 Total before adjustments", "line6TotalBeforeAdjustments"],
              ["Booked, check by check", "booked"],
            ] as const
          ).map(([label, key]) => (
            <tr key={key}>
              <td className="p-1">{label}</td>
              {reports.quarters.map((q, i) => (
                <td key={i} className="p-1 text-right">
                  {key === "employees" ? q[key] : money(q[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Form 940: payments {money(reports.futa.line3TotalPayments)}, over the $7,000 base {money(reports.futa.line5OverWageBase)},
        taxable {money(reports.futa.line7TaxableWages)}, FUTA tax {money(reports.futa.line8Tax)} (assumes the full state credit).
      </p>
      <table className="w-full">
        <thead>
          <tr className="text-left text-slate-500">
            {["W-2", "1 Wages", "2 Fed. withheld", "3 SS wages", "4 SS withheld", "5 Medicare wages", "6 Medicare withheld", "17 State withheld", "19 Local withheld"].map((h) => (
              <th key={h} className="p-1">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reports.w2.map((w) => (
            <tr key={w.employeeId}>
              <td className="p-1">{nameOf(w.employeeId)}</td>
              <td className="p-1">{money(w.box1Wages)}</td>
              <td className="p-1">{money(w.box2FederalWithheld)}</td>
              <td className="p-1">{money(w.box3SocialSecurityWages)}</td>
              <td className="p-1">{money(w.box4SocialSecurityWithheld)}</td>
              <td className="p-1">{money(w.box5MedicareWages)}</td>
              <td className="p-1">{money(w.box6MedicareWithheld)}</td>
              <td className="p-1">{money(w.box17StateWithheld)}</td>
              <td className="p-1">{money(w.box19LocalWithheld)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

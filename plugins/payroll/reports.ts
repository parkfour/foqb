// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Paycheck } from "./calc";
import { tablesFor } from "./calc";

// A paycheck as stored: who, when, the entry it posted, and its figures.
export interface PaycheckRecord extends Paycheck {
  id: string;
  employeeId: string;
  payDate: string;
  journalEntryId: string | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: PaycheckRecord[], key: keyof Paycheck) => cents(rows.reduce((s, r) => s + r[key], 0));
const quarterOf = (date: string) => Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;

// Draft figures for Form 941's lines (a quarter's checks by pay date).
export function form941(paychecks: PaycheckRecord[], year: number, quarter: number) {
  const t = tablesFor(year);
  const rows = paychecks.filter((p) => p.payDate.startsWith(String(year)) && quarterOf(p.payDate) === quarter);
  const ssWages = sum(rows, "socialSecurityWages");
  const medicareWages = sum(rows, "medicareWages");
  const addlWages = sum(rows, "additionalMedicareWages");
  const line5a = cents(ssWages * t.socialSecurityRate * 2);
  const line5c = cents(medicareWages * t.medicareRate * 2);
  const line5d = cents(addlWages * t.additionalMedicareRate);
  const line3 = sum(rows, "federal");
  return {
    employees: new Set(rows.map((r) => r.employeeId)).size,
    line2Wages: sum(rows, "gross"),
    line3Withheld: line3,
    line5aSocialSecurityWages: ssWages,
    line5aTax: line5a,
    line5cMedicareWages: medicareWages,
    line5cTax: line5c,
    line5dAdditionalMedicareWages: addlWages,
    line5dTax: line5d,
    line6TotalBeforeAdjustments: cents(line3 + line5a + line5c + line5d),
    // What was actually withheld and owed, check by check; line 7 on the
    // 941 is the rounding difference between the two.
    booked: cents(line3 + sum(rows, "socialSecurity") + sum(rows, "employerSocialSecurity") + sum(rows, "medicare") + sum(rows, "employerMedicare") + sum(rows, "additionalMedicare")),
  };
}

// Draft figures for Form 940 (the year's federal unemployment tax).
export function form940(paychecks: PaycheckRecord[], year: number) {
  const rows = paychecks.filter((p) => p.payDate.startsWith(String(year)));
  const total = sum(rows, "gross");
  const taxable = sum(rows, "futaWages");
  return {
    line3TotalPayments: total,
    line5OverWageBase: cents(total - taxable),
    line7TaxableWages: taxable,
    line8Tax: sum(rows, "futa"),
  };
}

// Draft W-2 boxes for each employee paid in the year.
export function w2s(paychecks: PaycheckRecord[], year: number) {
  const byEmployee = new Map<string, PaycheckRecord[]>();
  for (const p of paychecks.filter((r) => r.payDate.startsWith(String(year)))) {
    byEmployee.set(p.employeeId, [...(byEmployee.get(p.employeeId) ?? []), p]);
  }
  return [...byEmployee].map(([employeeId, rows]) => ({
    employeeId,
    box1Wages: sum(rows, "gross"),
    box2FederalWithheld: sum(rows, "federal"),
    box3SocialSecurityWages: sum(rows, "socialSecurityWages"),
    box4SocialSecurityWithheld: sum(rows, "socialSecurity"),
    box5MedicareWages: sum(rows, "medicareWages"),
    box6MedicareWithheld: cents(sum(rows, "medicare") + sum(rows, "additionalMedicare")),
    box16StateWages: sum(rows, "gross"),
    box17StateWithheld: sum(rows, "state"),
    box19LocalWithheld: sum(rows, "local"),
  }));
}

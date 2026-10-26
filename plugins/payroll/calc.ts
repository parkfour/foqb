// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TAX_TABLES, type Bracket, type FilingStatus, type YearTables } from "./tax-tables";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";
export const PERIODS: Record<PayFrequency, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

// What an employee's Form W-4 (2020 or later) says, and the rates the
// employer entered for their state and locality.
export interface Employee {
  id: string;
  name: string;
  address?: string;
  // Never shown in full; kept for the W-2 the employer prepares.
  ssnLast4?: string;
  payFrequency: PayFrequency;
  // Per period: a salary's paycheck, or an hourly rate.
  payType: "salary" | "hourly";
  payRate: number;
  filingStatus: FilingStatus;
  step2Checked: boolean;
  step3Credits: number; // annual
  step4aOtherIncome: number; // annual
  step4bDeductions: number; // annual
  step4cExtra: number; // per period
  exemptFromFederal: boolean;
  stateRate: number; // percent of gross, withheld
  localRate: number; // percent of gross, withheld
  active: boolean;
}

export interface EmployerRates {
  // State unemployment: the rate on each employee's wages up to the base.
  sutaRate: number; // percent
  sutaWageBase: number;
}

export interface YearToDate {
  wages: number;
}

export interface Paycheck {
  gross: number;
  federal: number;
  socialSecurity: number;
  medicare: number;
  additionalMedicare: number;
  state: number;
  local: number;
  net: number;
  employerSocialSecurity: number;
  employerMedicare: number;
  futa: number;
  suta: number;
  // Wages subject to each, for the 941, 940 and W-2.
  socialSecurityWages: number;
  medicareWages: number;
  additionalMedicareWages: number;
  futaWages: number;
  sutaWages: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function tablesFor(year: number): YearTables {
  const tables = TAX_TABLES[year];
  if (!tables) throw new Error(`There are no ${year} payroll tax tables yet`);
  return tables;
}

function tentative(brackets: Bracket[], annual: number): number {
  let row = brackets[0];
  for (const b of brackets) if (annual >= b[0]) row = b;
  return row[1] + row[2] * (annual - row[3]);
}

// Publication 15-T Worksheet 1A (automated payroll, W-4 from 2020 on).
export function federalWithholding(e: Employee, gross: number, tables: YearTables): number {
  if (e.exemptFromFederal || gross <= 0) return 0;
  const periods = PERIODS[e.payFrequency];
  const line1e = gross * periods + e.step4aOtherIncome;
  const line1g = e.step2Checked ? 0 : e.filingStatus === "married" ? tables.line1g.married : tables.line1g.other;
  const adjusted = Math.max(0, line1e - (e.step4bDeductions + line1g));
  const schedule = (e.step2Checked ? tables.step2 : tables.standard)[e.filingStatus];
  const perPeriod = tentative(schedule, adjusted) / periods;
  const afterCredits = Math.max(0, perPeriod - e.step3Credits / periods);
  return cents(afterCredits + e.step4cExtra);
}

// Taxable wages under a yearly cap, given what was paid before this check.
const underCap = (gross: number, before: number, cap: number) => Math.max(0, Math.min(gross, cap - before));

export function calculatePaycheck(e: Employee, gross: number, ytd: YearToDate, year: number, employer: EmployerRates): Paycheck {
  const t = tablesFor(year);
  const socialSecurityWages = underCap(gross, ytd.wages, t.socialSecurityWageBase);
  const additionalMedicareWages = Math.max(0, ytd.wages + gross - Math.max(t.additionalMedicareThreshold, ytd.wages));
  const futaWages = underCap(gross, ytd.wages, t.futaWageBase);
  const sutaWages = underCap(gross, ytd.wages, employer.sutaWageBase);

  const federal = federalWithholding(e, gross, t);
  const socialSecurity = cents(socialSecurityWages * t.socialSecurityRate);
  const medicare = cents(gross * t.medicareRate);
  const additionalMedicare = cents(additionalMedicareWages * t.additionalMedicareRate);
  const state = cents((gross * e.stateRate) / 100);
  const local = cents((gross * e.localRate) / 100);

  return {
    gross: cents(gross),
    federal,
    socialSecurity,
    medicare,
    additionalMedicare,
    state,
    local,
    net: cents(gross - federal - socialSecurity - medicare - additionalMedicare - state - local),
    employerSocialSecurity: socialSecurity,
    employerMedicare: medicare,
    futa: cents(futaWages * t.futaRate),
    suta: cents((sutaWages * employer.sutaRate) / 100),
    socialSecurityWages: cents(socialSecurityWages),
    medicareWages: cents(gross),
    additionalMedicareWages: cents(additionalMedicareWages),
    futaWages: cents(futaWages),
    sutaWages: cents(sutaWages),
  };
}

// The accounts a paycheck posts to, chosen once per book.
export interface PayrollAccounts {
  cash: string;
  wages: string;
  employerTaxes: string;
  federalPayable: string;
  ficaPayable: string;
  futaPayable: string;
  statePayable: string;
  sutaPayable: string;
  localPayable: string;
}

// One balanced entry: wages and the employer's taxes as expenses; net pay
// from cash; everything withheld or owed as liabilities until it's paid.
export function paycheckLines(p: Paycheck, a: PayrollAccounts): { account_id: string; debit: number; credit: number }[] {
  const employerTaxes = cents(p.employerSocialSecurity + p.employerMedicare + p.futa + p.suta);
  const fica = cents(p.socialSecurity + p.medicare + p.additionalMedicare + p.employerSocialSecurity + p.employerMedicare);
  return [
    { account_id: a.wages, debit: p.gross, credit: 0 },
    { account_id: a.employerTaxes, debit: employerTaxes, credit: 0 },
    { account_id: a.cash, debit: 0, credit: p.net },
    { account_id: a.federalPayable, debit: 0, credit: p.federal },
    { account_id: a.ficaPayable, debit: 0, credit: fica },
    { account_id: a.futaPayable, debit: 0, credit: p.futa },
    { account_id: a.statePayable, debit: 0, credit: p.state },
    { account_id: a.sutaPayable, debit: 0, credit: p.suta },
    { account_id: a.localPayable, debit: 0, credit: p.local },
  ].filter((l) => l.debit > 0 || l.credit > 0);
}

// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FOQBPlugin } from "@/lib/plugins/types";
import { PayrollPage } from "./payroll-page";
import { PayrollReport } from "./payroll-report";

export const payrollPlugin: FOQBPlugin = {
  manifest: {
    id: "payroll",
    name: "Payroll (US)",
    version: "0.1.0",
    description:
      "Pay employees: federal income tax withholding from IRS Publication 15-T, Social Security, Medicare and FUTA, state and local withholding at rates you enter, one journal entry per paycheck, and draft figures for Forms 941, 940 and W-2. Files and pays nothing.",
    acknowledgement: {
      version: "2026-10-25",
      title: "Payroll: talk to your tax professional before relying on this",
      text: [
        "This plugin is not tax, legal or payroll advice, and it is not a payroll service. It works out withholding from IRS Publication 15-T and posts journal entries; it does not file returns, make tax deposits, pay employees, register you with any agency or keep you compliant.",
        "Payroll mistakes cost real money. Late or wrong deposits and filings bring IRS and state penalties and interest, and an employer is personally responsible for withheld taxes it fails to pay over (the trust fund recovery penalty).",
        "It handles only simple cases: no pre-tax deductions (401(k), health insurance, cafeteria plans), tips, fringe benefits, garnishments, multiple states, reciprocity, supplemental wage rules, or state and local tax beyond a flat rate you enter. Its tax tables cover the years it ships with; check them against the IRS every year.",
        "Before you run a payroll, file a Form 941, 940 or W-2, or make a deposit, have a CPA, enrolled agent or payroll professional review the setup and the figures. You are responsible for what you file and pay.",
      ],
    },
  },
  reports: [{ id: "payroll-forms", title: "Payroll forms (941, 940, W-2)", range: false, workspace: "business", component: PayrollReport }],
  pages: [
    {
      slug: "run",
      title: "Payroll",
      description: "Employees, paychecks, and draft figures for Forms 941, 940 and W-2.",
      workspace: "business",
      component: PayrollPage,
    },
  ],
};

import { describe, expect, it } from "vitest";
import { calculatePaycheck, type Employee } from "@/plugins/payroll/calc";
import { form940, form941, w2s, type PaycheckRecord } from "@/plugins/payroll/reports";

const ann: Employee = {
  id: "ann", name: "Ann", payFrequency: "monthly", payType: "salary", payRate: 5000, filingStatus: "single", step2Checked: false,
  step3Credits: 0, step4aOtherIncome: 0, step4bDeductions: 0, step4cExtra: 0, exemptFromFederal: false, stateRate: 5, localRate: 0, active: true,
};

// Twelve monthly $5,000 checks.
const year: PaycheckRecord[] = Array.from({ length: 12 }, (_, i) => ({
  ...calculatePaycheck(ann, 5000, { wages: 5000 * i }, 2026, { sutaRate: 2.7, sutaWageBase: 9000 }),
  id: `p${i}`,
  employeeId: "ann",
  payDate: `2026-${String(i + 1).padStart(2, "0")}-28`,
  journalEntryId: null,
}));

describe("payroll reports", () => {
  it("adds a quarter's checks into the 941's lines", () => {
    const q = form941(year, 2026, 1);
    expect(q).toMatchObject({ employees: 1, line2Wages: 15000, line5aSocialSecurityWages: 15000, line5aTax: 1860, line5cTax: 435 });
    expect(q.line6TotalBeforeAdjustments).toBeCloseTo(q.booked, 1);
  });

  it("takes FUTA on the first $7,000 only, for the 940", () => {
    expect(form940(year, 2026)).toEqual({ line3TotalPayments: 60000, line5OverWageBase: 53000, line7TaxableWages: 7000, line8Tax: 42 });
  });

  it("gives each employee's W-2 boxes", () => {
    expect(w2s(year, 2026)).toEqual([
      expect.objectContaining({ employeeId: "ann", box1Wages: 60000, box3SocialSecurityWages: 60000, box4SocialSecurityWithheld: 3720, box17StateWithheld: 3000 }),
    ]);
  });
});

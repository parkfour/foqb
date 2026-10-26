import { describe, expect, it } from "vitest";
import { calculatePaycheck, federalWithholding, paycheckLines, tablesFor, type Employee } from "@/plugins/payroll/calc";

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: "e1",
  name: "Ann",
  payFrequency: "biweekly",
  payType: "salary",
  payRate: 2000,
  filingStatus: "single",
  step2Checked: false,
  step3Credits: 0,
  step4aOtherIncome: 0,
  step4bDeductions: 0,
  step4cExtra: 0,
  exemptFromFederal: false,
  stateRate: 4,
  localRate: 0,
  active: true,
  ...over,
});
const employer = { sutaRate: 2.7, sutaWageBase: 9000 };

describe("federal withholding (Pub 15-T 2026, Worksheet 1A)", () => {
  const t = tablesFor(2026);

  it("works a single biweekly $2,000 check", () => {
    // 52,000 - 8,600 = 43,400; 1,240 + 12% of (43,400 - 19,900) = 4,060; / 26 = 156.15.
    expect(federalWithholding(employee(), 2000, t)).toBe(156.15);
  });

  it("uses the married schedule, credits and extra withholding", () => {
    // 52,000 - 12,900 = 39,100; 10% of (39,100 - 19,300) = 1,980; /26 = 76.15;
    // less 2,000/26 = 76.92 in credits -> 0; plus 25 extra.
    expect(federalWithholding(employee({ filingStatus: "married", step3Credits: 2000, step4cExtra: 25 }), 2000, t)).toBe(25);
  });

  it("uses the Step 2 schedule with no line 1g", () => {
    // 52,000: 2,900 + 22% of (52,000 - 33,250) = 7,025; / 26 = 270.19.
    expect(federalWithholding(employee({ step2Checked: true }), 2000, t)).toBe(270.19);
  });

  it("withholds nothing for an exempt employee", () => {
    expect(federalWithholding(employee({ exemptFromFederal: true }), 2000, t)).toBe(0);
  });
});

describe("calculatePaycheck", () => {
  it("withholds FICA and state tax, and works out the employer's share", () => {
    const p = calculatePaycheck(employee(), 2000, { wages: 0 }, 2026, employer);
    expect(p).toMatchObject({
      socialSecurity: 124,
      medicare: 29,
      additionalMedicare: 0,
      state: 80,
      net: 2000 - 156.15 - 124 - 29 - 80,
      employerSocialSecurity: 124,
      employerMedicare: 29,
      futa: 12,
      suta: 54,
    });
  });

  it("stops Social Security, FUTA and SUTA at their wage bases", () => {
    const p = calculatePaycheck(employee({ payRate: 10000 }), 10000, { wages: 180000 }, 2026, employer);
    expect(p.socialSecurityWages).toBe(4500);
    expect(p.futa).toBe(0);
    expect(p.suta).toBe(0);
  });

  it("adds the employee's extra 0.9% Medicare over $200,000", () => {
    const p = calculatePaycheck(employee(), 10000, { wages: 195000 }, 2026, employer);
    expect(p.additionalMedicareWages).toBe(5000);
    expect(p.additionalMedicare).toBe(45);
  });

  it("refuses a year without tables", () => {
    expect(() => calculatePaycheck(employee(), 100, { wages: 0 }, 2031, employer)).toThrow(/no 2031 payroll tax tables/);
  });
});

describe("paycheckLines", () => {
  it("balances", () => {
    const p = calculatePaycheck(employee({ localRate: 1 }), 2000, { wages: 0 }, 2026, employer);
    const accounts = { cash: "c", wages: "w", employerTaxes: "et", federalPayable: "f", ficaPayable: "fi", futaPayable: "fu", statePayable: "s", sutaPayable: "su", localPayable: "l" };
    const lines = paycheckLines(p, accounts);
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
  });
});

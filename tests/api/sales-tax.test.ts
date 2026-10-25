import { describe, expect, it } from "vitest";
import { applyTaxes } from "@/lib/sales-tax";
import { summarizeSalesTax } from "@/lib/reports/sales-tax";

describe("sales tax", () => {
  it("rounds each rate's tax on its own and totals them", () => {
    const { taxes, totalRate, totalTax } = applyTaxes(99.99, [
      { id: "s", name: "State", rate: 6.25, account_id: "a1" },
      { id: "c", name: "City", rate: 2, account_id: null },
    ]);
    expect(taxes.map((t) => t.amount)).toEqual([6.25, 2]);
    expect(totalRate).toBe(8.25);
    expect(totalTax).toBe(8.25);
  });

  it("totals taxable sales and tax per rate, with single-rate invoices together and void ones left out", () => {
    const line = (amount: number) => ({ amount });
    const rows = summarizeSalesTax(
      [
        { status: "open", tax_amount: 8.25, invoice_lines: [line(100)], invoice_taxes: [
          { tax_rate_id: "s", name: "State", amount: 6.25, account_id: "a1" },
          { tax_rate_id: "c", name: "City", amount: 2, account_id: "a2" },
        ] },
        { status: "paid", tax_amount: 3.13, invoice_lines: [line(50)], invoice_taxes: [{ tax_rate_id: "s", name: "State", amount: 3.13, account_id: "a1" }] },
        { status: "void", tax_amount: 10, invoice_lines: [line(1000)], invoice_taxes: [{ tax_rate_id: "s", name: "State", amount: 62.5, account_id: "a1" }] },
        { status: "open", tax_amount: 7, invoice_lines: [line(70), line(30)], invoice_taxes: [] },
        { status: "open", tax_amount: 0, invoice_lines: [line(20)], invoice_taxes: [] },
      ],
      "payable",
    );
    expect(rows).toEqual([
      { key: "c", name: "City", accountId: "a2", taxableSales: 100, collected: 2 },
      { key: "single", name: "Single rate", accountId: "payable", taxableSales: 100, collected: 7 },
      { key: "s", name: "State", accountId: "a1", taxableSales: 150, collected: 9.38 },
    ]);
  });
});

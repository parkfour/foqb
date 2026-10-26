import { describe, expect, it } from "vitest";
import { isVatNumberShape } from "@/plugins/eu-vat/rates";
import { vatSummary } from "@/plugins/eu-vat/summary";

describe("EU VAT plugin", () => {
  it("accepts a VAT number's shape, with spaces or dots, and refuses others", () => {
    expect(isVatNumberShape("DE 123 456 789")).toBe(true);
    expect(isVatNumberShape("EL123456789")).toBe(true);
    expect(isVatNumberShape("US123456789")).toBe(false);
  });

  it("totals VAT by rate, sets reverse-charge sales apart, and takes off input VAT", () => {
    const s = vatSummary(
      [
        { id: "1", customer_id: "local", subtotal: 100, taxes: [{ name: "VAT 21%", rate: 21, amount: 21 }] },
        { id: "2", customer_id: "local", subtotal: 50, taxes: [{ name: "VAT 9%", rate: 9, amount: 4.5 }] },
        { id: "3", customer_id: "b2b-de", subtotal: 1000, taxes: [] },
        { id: "4", customer_id: "us", subtotal: 200, taxes: [] },
        { id: "5", customer_id: "local", subtotal: 200, taxes: [{ name: "VAT 21%", rate: 21, amount: 42 }] },
      ],
      new Set(["b2b-de"]),
      30,
    );
    expect(s).toEqual({
      byRate: [
        { name: "VAT 21%", rate: 21, net: 300, vat: 63 },
        { name: "VAT 9%", rate: 9, net: 50, vat: 4.5 },
      ],
      reverseCharge: 1000,
      noVat: 200,
      outputVat: 67.5,
      inputVat: 30,
      due: 37.5,
    });
  });
});

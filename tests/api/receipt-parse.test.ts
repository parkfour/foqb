import { describe, expect, it } from "vitest";
import { findDate, matchVendor, parseReceipt } from "@/plugins/receipt-ocr/parse";

const HARDWARE = `ACME HARDWARE
123 Main St, Springfield
Tel (555) 010-2000
10/14/2026  3:42 PM
Receipt # A-20931
Wood screws 2 x 4.50   9.00
Paint roller            12.99
Drop cloth              7.49
SUBTOTAL               29.48
SALES TAX 8.25%         2.43
TOTAL                  31.91
VISA ****1234          31.91
CHANGE                  0.00
Thank you for shopping!`;

describe("parseReceipt", () => {
  it("reads a typical store receipt, with items that add up", () => {
    expect(parseReceipt(HARDWARE)).toEqual({
      vendorName: "ACME HARDWARE",
      date: "2026-10-14",
      receiptNumber: "A-20931",
      subtotal: 29.48,
      tax: 2.43,
      total: 31.91,
      items: [
        { description: "Wood screws", quantity: 2, unitPrice: 4.5 },
        { description: "Paint roller", quantity: 1, unitPrice: 12.99 },
        { description: "Drop cloth", quantity: 1, unitPrice: 7.49 },
      ],
    });
  });

  it("leaves out items that don't add up to the total, rather than guess", () => {
    const misread = HARDWARE.replace("12.99", "17.99");
    const parsed = parseReceipt(misread);
    expect(parsed.total).toBe(31.91);
    expect(parsed.items).toBeUndefined();
  });

  it("prefers an amount due over a running total", () => {
    const text = "Cafe Luna\nTotal 18.00\nTip 3.00\nAmount Due 21.00";
    expect(parseReceipt(text).total).toBe(21);
  });

  it("returns nothing it couldn't read", () => {
    expect(parseReceipt("~~ smudge ~~\n12 34")).toEqual({ vendorName: "~~ smudge ~~" });
    expect(parseReceipt("")).toEqual({});
  });

  it("reads thousands separators", () => {
    expect(parseReceipt("Big Supplier\nTotal $1,204.50").total).toBe(1204.5);
  });
});

describe("findDate", () => {
  it("reads common receipt date formats", () => {
    expect(findDate("2026-10-14")).toBe("2026-10-14");
    expect(findDate("Date: 10/14/26")).toBe("2026-10-14");
    expect(findDate("Oct 14, 2026")).toBe("2026-10-14");
    expect(findDate("14 October 2026")).toBe("2026-10-14");
  });

  it("skips impossible dates", () => {
    expect(findDate("13/45/2026 then 02/03/2026")).toBe("2026-02-03");
  });
});

describe("matchVendor", () => {
  const vendors = [
    { id: "1", name: "Acme" },
    { id: "2", name: "Acme Hardware" },
    { id: "3", name: "Cafe Luna" },
  ];

  it("matches the vendor named at the top, preferring the longer name", () => {
    expect(matchVendor(HARDWARE, vendors)?.id).toBe("2");
    expect(matchVendor("CAFE LUNA\nlatte 4.00", vendors)?.id).toBe("3");
  });

  it("matches nothing when unsure", () => {
    expect(matchVendor("Corner Store\nmilk 3.00", vendors)).toBeUndefined();
    expect(matchVendor("Acme Hardware and Cafe Luna", vendors)).toBeUndefined();
  });
});

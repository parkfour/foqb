import { describe, expect, it } from "vitest";
import { buildStatement } from "@/lib/ar/statement";

describe("buildStatement", () => {
  it("carries in the earlier balance, then lists invoices and payments in order with a running balance", () => {
    const s = buildStatement(
      [
        { id: "a", invoice_number: "1", invoice_date: "2026-08-10", due_date: null, total: 100, payments: [{ payment_date: "2026-08-20", amount: 60 }, { payment_date: "2026-09-05", amount: 40 }] },
        { id: "b", invoice_number: "2", invoice_date: "2026-09-05", due_date: null, total: 250, payments: [] },
        { id: "c", invoice_number: "3", invoice_date: "2026-10-02", due_date: null, total: 75, payments: [] },
      ],
      "2026-09-01",
      "2026-09-30",
    );
    expect(s.opening).toBe(40);
    expect(s.lines.map((l) => [l.label, l.amount, l.balance])).toEqual([
      ["Invoice 2", 250, 290],
      ["Payment, invoice 1", -40, 250],
    ]);
    expect(s.closing).toBe(250);
  });
});

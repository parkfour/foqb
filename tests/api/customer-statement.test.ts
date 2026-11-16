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

  it("lists an unapplied credit memo as a credit on its date, and carries in earlier ones", () => {
    const s = buildStatement(
      [{ id: "a", invoice_number: "1", invoice_date: "2026-09-02", due_date: null, total: 100, payments: [] }],
      "2026-09-01",
      "2026-09-30",
      [
        { memo_number: "CM-1", memo_date: "2026-08-15", total: 10 },
        { memo_number: "CM-2", memo_date: "2026-09-02", total: 30 },
        { memo_number: "CM-3", memo_date: "2026-10-01", total: 99 },
      ],
    );
    expect(s.opening).toBe(-10);
    expect(s.lines.map((l) => [l.label, l.amount, l.balance])).toEqual([
      ["Invoice 1", 100, 90],
      ["Credit memo CM-2, not yet applied", -30, 60],
    ]);
    expect(s.closing).toBe(60);
  });
});

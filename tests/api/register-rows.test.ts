import { describe, expect, it } from "vitest";
import { registerRows, type RawTx } from "@/lib/register/rows";

const line = (account_id: string, debit: number, credit: number, extra: Partial<{ name: string; reconciliation_id: string }> = {}) => ({
  id: `${account_id}-${debit}-${credit}`,
  account_id,
  debit,
  credit,
  reconciliation_id: extra.reconciliation_id ?? null,
  accounts: { name: extra.name ?? account_id },
});

const tx = (overrides: Partial<RawTx>): RawTx => ({
  id: "t",
  date: "2026-03-01",
  name: "Row",
  amount: -10,
  status: "unreconciled",
  account_id: "checking",
  accounts: { name: "Checking" },
  ...overrides,
});

describe("registerRows", () => {
  it("names a booked row by its one category, a split as Split, and the rest as waiting or ignored", () => {
    const rows = registerRows([
      tx({ id: "one", status: "matched", journal_entries: { status: "posted", journal_lines: [line("groceries", 10, 0, { name: "Groceries" }), line("checking", 0, 10)] } }),
      tx({ id: "split", status: "matched", journal_entries: { status: "posted", journal_lines: [line("groceries", 6, 0), line("dining", 4, 0), line("checking", 0, 10)] } }),
      tx({ id: "waiting" }),
      tx({ id: "ignored", status: "ignored" }),
    ]);

    expect(rows.map((r) => [r.id, r.category_name, r.category_id, r.is_split, r.categorized, r.ignored])).toEqual([
      ["one", "Groceries", "groceries", false, true, false],
      ["split", "Split", null, true, true, false],
      ["waiting", "Uncategorized", null, false, false, false],
      ["ignored", "Ignored", null, false, true, true],
    ]);
  });

  it("is reconciled only when a reconciliation covers the bank account's own line, otherwise cleared or pending", () => {
    const rows = registerRows([
      tx({ id: "rec", status: "matched", journal_entries: { status: "posted", journal_lines: [line("groceries", 10, 0), line("checking", 0, 10, { reconciliation_id: "r1" })] } }),
      // The other account's line is reconciled, not this one's.
      tx({ id: "other", status: "matched", cleared: true, journal_entries: { status: "posted", journal_lines: [line("card", 10, 0, { reconciliation_id: "r2" }), line("checking", 0, 10)] } }),
      tx({ id: "pending" }),
    ]);

    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["rec", "reconciled"],
      ["other", "cleared"],
      ["pending", "pending"],
    ]);
  });

  it("offers the other side of a transfer between two uncategorized rows", () => {
    const rows = registerRows([
      tx({ id: "out", amount: -300, date: "2026-03-10" }),
      tx({ id: "in", amount: 300, date: "2026-03-11", account_id: "savings", accounts: { name: "Savings" } }),
      tx({ id: "booked", amount: 300, status: "matched", account_id: "card", accounts: { name: "Card" } }),
    ]);

    expect(rows.find((r) => r.id === "out")?.transfer).toEqual({ account_id: "savings", account_name: "Savings" });
    expect(rows.find((r) => r.id === "in")?.transfer).toEqual({ account_id: "checking", account_name: "Checking" });
    expect(rows.find((r) => r.id === "booked")?.transfer).toBeUndefined();
  });
});

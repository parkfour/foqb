import { describe, expect, it } from "vitest";
import { journalEntriesToCsv, parseJournalEntriesCsv } from "@/lib/csv/journal-entries";

describe("journalEntriesToCsv", () => {
  it("serializes one row per line with a header", () => {
    const csv = journalEntriesToCsv([
      { entry_ref: "e1", entry_date: "2026-01-05", memo: "Investment", account_number: "1000", debit: 1000, credit: 0 },
      { entry_ref: "e1", entry_date: "2026-01-05", memo: "Investment", account_number: "3000", debit: 0, credit: 1000 },
    ]);

    expect(csv).toBe(
      [
        "entry_ref,entry_date,memo,account_number,debit,credit",
        "e1,2026-01-05,Investment,1000,1000.00,0.00",
        "e1,2026-01-05,Investment,3000,0.00,1000.00",
      ].join("\r\n"),
    );
  });
});

describe("parseJournalEntriesCsv", () => {
  it("groups multiple line rows into one entry by entry_ref", () => {
    const csv = [
      "entry_ref,entry_date,memo,account_number,debit,credit",
      "1,2026-01-05,Investment,1000,1000.00,0.00",
      "1,2026-01-05,Investment,3000,0.00,1000.00",
      "2,2026-01-10,Sale,1000,500.00,0.00",
      "2,2026-01-10,Sale,4000,0.00,500.00",
    ].join("\n");

    const { entries, errors } = parseJournalEntriesCsv(csv);

    expect(errors).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      ref: "1",
      entryDate: "2026-01-05",
      memo: "Investment",
      lines: [
        { accountNumber: "1000", debit: 1000, credit: 0 },
        { accountNumber: "3000", debit: 0, credit: 1000 },
      ],
    });
  });

  it("flags an entry whose lines don't balance", () => {
    const csv = [
      "entry_ref,entry_date,memo,account_number,debit,credit",
      "1,2026-01-05,Investment,1000,1000.00,0.00",
      "1,2026-01-05,Investment,3000,0.00,900.00",
    ].join("\n");

    const { entries, errors } = parseJournalEntriesCsv(csv);
    expect(errors[0]).toMatch(/do not equal total credits/i);
    // Excluded from `entries`, not just flagged — callers must never attempt
    // to persist an entry already known to be unbalanced.
    expect(entries).toEqual([]);
  });

  it("rejects a line with both debit and credit set", () => {
    const csv = [
      "entry_ref,entry_date,memo,account_number,debit,credit",
      "1,2026-01-05,Bad,1000,100.00,50.00",
    ].join("\n");

    const { entries, errors } = parseJournalEntriesCsv(csv);
    expect(entries).toEqual([]);
    expect(errors[0]).toMatch(/exactly one of debit or credit/i);
  });

  it("rejects a line with neither debit nor credit set", () => {
    const csv = [
      "entry_ref,entry_date,memo,account_number,debit,credit",
      "1,2026-01-05,Bad,1000,0,0",
    ].join("\n");

    const { entries, errors } = parseJournalEntriesCsv(csv);
    expect(entries).toEqual([]);
    expect(errors[0]).toMatch(/exactly one of debit or credit/i);
  });

  it("rejects rows missing required fields", () => {
    const csv = ["entry_ref,entry_date,memo,account_number,debit,credit", ",2026-01-05,Bad,1000,100,0"].join(
      "\n",
    );
    const { entries, errors } = parseJournalEntriesCsv(csv);
    expect(entries).toEqual([]);
    expect(errors[0]).toMatch(/required/i);
  });

  it("tolerates floating point rounding within a cent", () => {
    const csv = [
      "entry_ref,entry_date,memo,account_number,debit,credit",
      "1,2026-01-05,Rounding,1000,0.1,0",
      "1,2026-01-05,Rounding,2000,0,0.1",
    ].join("\n");

    const { errors } = parseJournalEntriesCsv(csv);
    expect(errors).toEqual([]);
  });
});

describe("formula injection", () => {
  it("escapes formula-looking text but leaves amounts as numbers", () => {
    const csv = journalEntriesToCsv([
      { entry_ref: "1", entry_date: "2026-01-02", memo: "+cmd|' /C calc'!A0", account_number: "1000", debit: 10, credit: 0 },
      { entry_ref: "1", entry_date: "2026-01-02", memo: "+cmd|' /C calc'!A0", account_number: "4000", debit: 0, credit: 10 },
    ]);
    expect(csv).toContain("'+cmd");
    expect(csv).toMatch(/,10\.00,0\.00$/m); // debits/credits are never negative, so never escaped

    const { entries } = parseJournalEntriesCsv(csv);
    expect(entries[0].memo).toBe("+cmd|' /C calc'!A0");
  });
});

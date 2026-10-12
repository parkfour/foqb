import { describe, expect, it } from "vitest";
import { isWaveJournalCsv, parseWaveJournalEntriesCsv } from "@/lib/csv/wave-journal-entries";

const HEADER =
  "Transaction ID,Transaction Date,Account Name,Transaction Description,Transaction Line Description," +
  "Amount (One column), ,Debit Amount (Two Column Approach),Credit Amount (Two Column Approach)," +
  "Other Accounts for this Transaction,Customer,Vendor,Invoice Number,Bill Number,Notes / Memo," +
  "Amount Before Sales Tax,Sales Tax Amount,Sales Tax Name,Transaction Date Added," +
  "Transaction Date Last Modified,Account Group,Account Type,Account ID";

function row(fields: {
  id: string;
  date: string;
  account: string;
  description?: string;
  debit?: string;
  credit?: string;
  group: string;
}): string {
  return [
    fields.id,
    fields.date,
    fields.account,
    fields.description ?? "",
    "",
    fields.debit || fields.credit || "",
    "",
    fields.debit ?? "",
    fields.credit ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    fields.group,
    "",
    "",
  ].join(",");
}

describe("isWaveJournalCsv", () => {
  it("detects the Wave header shape", () => {
    expect(isWaveJournalCsv(HEADER + "\n")).toBe(true);
  });

  it("rejects our native journal-entries header shape", () => {
    expect(isWaveJournalCsv("entry_ref,entry_date,memo,account_number,debit,credit\n")).toBe(false);
  });
});

describe("parseWaveJournalEntriesCsv", () => {
  it("groups two legs sharing a Transaction ID into one balanced entry", () => {
    const csv = [
      HEADER,
      row({ id: "t1", date: "2019-01-08", account: "HSBC Personal", description: "QB/Ideal", credit: "157.25", group: "Liability" }),
      row({ id: "t1", date: "2019-01-08", account: "Computer – Software", description: "QB/Ideal", debit: "157.25", group: "Expense" }),
    ].join("\n");

    const { entries, errors } = parseWaveJournalEntriesCsv(csv);

    expect(errors).toEqual([]);
    expect(entries).toEqual([
      {
        ref: "t1",
        entryDate: "2019-01-08",
        memo: "QB/Ideal",
        lines: [
          { accountName: "HSBC Personal", accountType: "liability", debit: 0, credit: 157.25 },
          { accountName: "Computer – Software", accountType: "expense", debit: 157.25, credit: 0 },
        ],
      },
    ]);
  });

  it("maps Wave's Income group to our revenue type", () => {
    const csv = [
      HEADER,
      row({ id: "t2", date: "2020-01-01", account: "Sales", credit: "100", group: "Income" }),
      row({ id: "t2", date: "2020-01-01", account: "Cash", debit: "100", group: "Asset" }),
    ].join("\n");

    const { entries } = parseWaveJournalEntriesCsv(csv);
    expect(entries[0].lines[0].accountType).toBe("revenue");
  });

  it("excludes and flags an unbalanced entry", () => {
    const csv = [
      HEADER,
      row({ id: "t3", date: "2020-01-01", account: "Cash", debit: "100", group: "Asset" }),
      row({ id: "t3", date: "2020-01-01", account: "Sales", credit: "90", group: "Income" }),
    ].join("\n");

    const { entries, errors } = parseWaveJournalEntriesCsv(csv);
    expect(entries).toEqual([]);
    expect(errors[0]).toMatch(/do not equal/i);
  });

  it("rejects a row with an unrecognized Account Group", () => {
    const csv = [HEADER, row({ id: "t4", date: "2020-01-01", account: "Mystery", debit: "10", group: "Nonsense" })].join(
      "\n",
    );

    const { entries, errors } = parseWaveJournalEntriesCsv(csv);
    expect(entries).toEqual([]);
    expect(errors[0]).toMatch(/Account Group/i);
  });
});

import { describe, expect, it } from "vitest";
import { accountsToCsv, parseAccountsCsv } from "@/lib/csv/accounts";

describe("accountsToCsv", () => {
  it("serializes accounts with a header row", () => {
    const csv = accountsToCsv([
      { account_number: "1000", name: "Cash", type: "asset", description: null, is_active: true },
    ]);

    expect(csv).toBe(
      "account_number,name,type,description,is_active\r\n1000,Cash,asset,,true",
    );
  });
});

describe("parseAccountsCsv", () => {
  it("parses valid rows", () => {
    const csv = "account_number,name,type,description,is_active\n1000,Cash,asset,Main cash,true";
    const { records, errors } = parseAccountsCsv(csv);

    expect(errors).toEqual([]);
    expect(records).toEqual([
      { account_number: "1000", name: "Cash", type: "asset", description: "Main cash", is_active: true },
    ]);
  });

  it("defaults is_active to true when omitted", () => {
    const csv = "account_number,name,type\n1000,Cash,asset";
    const { records } = parseAccountsCsv(csv);
    expect(records[0].is_active).toBe(true);
  });

  it("treats is_active=false as inactive", () => {
    const csv = "account_number,name,type,description,is_active\n1000,Cash,asset,,false";
    const { records } = parseAccountsCsv(csv);
    expect(records[0].is_active).toBe(false);
  });

  it.each(["false", "FALSE", "no", "N", "0", "f", "off", "inactive", " no "])(
    "treats is_active=%s as inactive",
    (value) => {
      const csv = `account_number,name,type,description,is_active\n1000,Cash,asset,,${value}`;
      const { records } = parseAccountsCsv(csv);
      expect(records[0].is_active).toBe(false);
    },
  );

  it.each(["true", "yes", "1", "active", "TRUE"])("treats is_active=%s as active", (value) => {
    const csv = `account_number,name,type,description,is_active\n1000,Cash,asset,,${value}`;
    const { records } = parseAccountsCsv(csv);
    expect(records[0].is_active).toBe(true);
  });

  it("rejects rows missing required fields", () => {
    const csv = "account_number,name,type\n,Cash,asset";
    const { records, errors } = parseAccountsCsv(csv);
    expect(records).toEqual([]);
    expect(errors[0]).toMatch(/required/i);
  });

  it("rejects an invalid account type", () => {
    const csv = "account_number,name,type\n1000,Cash,not-a-type";
    const { records, errors } = parseAccountsCsv(csv);
    expect(records).toEqual([]);
    expect(errors[0]).toMatch(/invalid type/i);
  });

  it("lowercases the type", () => {
    const csv = "account_number,name,type\n1000,Cash,ASSET";
    const { records } = parseAccountsCsv(csv);
    expect(records[0].type).toBe("asset");
  });
});

describe("formula injection", () => {
  it("escapes text a spreadsheet would run as a formula, and imports it back unchanged", () => {
    const csv = accountsToCsv([
      { account_number: "1000", name: "=HYPERLINK(\"http://evil\")", type: "asset", description: "@note", is_active: true },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("'@note");

    const { records } = parseAccountsCsv(csv);
    expect(records[0].name).toBe('=HYPERLINK("http://evil")');
    expect(records[0].description).toBe("@note");
  });
});

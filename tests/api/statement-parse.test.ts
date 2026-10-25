import { describe, expect, it } from "vitest";
import { parseMoney, parseStatement, statementDifference } from "@/plugins/statement-import/parse";
import { ocrLines, pageLines } from "@/plugins/statement-import/text-lines";

// Made-up statements in each bank's layout, as pageLines renders them.

const capitalOne = [
  "Thanks for saving with Capital One 360®",
  "STATEMENT PERIOD",
  "Dec 15 - Jan 14, 2027",
  "Everyday Savings - 36100001234",
  "DATE | DESCRIPTION | CATEGORY | AMOUNT | BALANCE",
  "Dec 15 | Opening Balance | $1,000.00",
  "Preauthorized Deposit from",
  "Dec 20 | Credit | + $2,500.00 | $3,500.00",
  "EMPLOYER checking account XXXX1234",
  "Dec 31 | Interest Rate Change from 2.960% to 3.057% | $3,500.00",
  "Jan 2 | Withdrawal to CHECKING | Debit | - $400.50 | $3,099.50",
  "Jan 14 | Closing Balance | $3,099.50",
  "capitalone.com | 1-888-464-0727",
];

const bofaChecking = [
  "Bank of America, N.A.",
  "for March 11, 2027 to April 9, 2027 | Account number: 1234 5678 9012",
  "Beginning balance on March 11, 2027 | $1,000.00",
  "Ending balance on April 9, 2027 | $1,429.10",
  "Deposits and other additions",
  "Date | Description | Amount",
  "03/16/27 | Zelle payment from A TENANT Conf# abc | 1,200.00",
  "Total deposits and other additions | $1,200.00",
  "JANE DOE ! Account # 1234 5678 9012 ! March 11, 2027 to April 9, 2027",
  "Withdrawals and other subtractions",
  "Date | Description | Amount",
  "03/18/27 | UTILITY CO DES:BILL ID:123 INDN:Jane Doe | CO ID:000 | -70.90",
  "PPD",
  "04/02/27 | INSURER DES:PREMIUM | -700.00",
  "Total withdrawals and other subtractions | -$770.90",
  "Pause and verify to help prevent scams.",
];

const bofaCard = [
  "Bank of America",
  "Account# 4400 0000 0000 9876",
  "December 19 - January 18, 2027",
  "Previous Balance | $200.00",
  "New Balance Total | $286.81",
  "Payments and Other Credits",
  "01/10 | 01/10 | PAYMENT FROM CHK 9012 CONF#xyz | 1448 | 9876 | -200.00",
  "Purchases and Adjustments",
  "12/18 | 12/20 | TST*PIZZA PLACE | Somewhere VT | 9978 | 9876 | 86.81",
  "12/29 | 12/31 | ELECTRIFY CANADA | AJAX | ON | 8607 | 9876 | 200.00",
  "270.00 CAD",
  "01/18 | 01/18 | INTEREST CHARGED ON PURCHASES | 0.00",
  "TOTAL PURCHASES AND ADJUSTMENTS FOR THIS PERIOD | $286.81",
];

describe("parseMoney", () => {
  it("reads the ways statements write amounts", () => {
    expect(parseMoney("$1,227.67")).toBe(1227.67);
    expect(parseMoney("-$2,884.26")).toBe(-2884.26);
    expect(parseMoney("- $400.50")).toBe(-400.5);
    expect(parseMoney("+ $15.00")).toBe(15);
    expect(parseMoney("-70.90")).toBe(-70.9);
    expect(parseMoney("$.06")).toBe(0.06);
    expect(parseMoney("Credit")).toBeNull();
  });
});

const genericChecking = [
  "Anytown Community Bank",
  "Statement period 03/01/2027 through 03/31/2027 | Account number: 0000 5678",
  "Beginning balance | $1,000.00",
  "Ending balance | $1,375.50",
  "Date | Description | Amount | Balance",
  "03/02 | PAYROLL DEPOSIT | 500.00 | 1,500.00",
  "03/09 | ELECTRIC CO | 124.50 | 1,375.50",
  "03/31 | Ending balance | 1,375.50",
];

const genericSections = [
  "Anytown Credit Union",
  "Member account ending 4321 | March 1, 2027 to March 31, 2027",
  "Previous balance | 200.00 | New balance | 150.00",
  "Deposits and credits",
  "03/05 | TRANSFER FROM SAVINGS | 100.00",
  "Withdrawals and debits",
  "03/12 | GROCERY STORE | 150.00",
];

const genericCard = [
  "Anytown Rewards Visa | Account ending in 9999",
  "Billing cycle Mar 2, 2027 - Apr 1, 2027 | Minimum payment due $25.00",
  "Previous balance | $300.00",
  "New balance | $360.00",
  "Mar 05 | Mar 06 | HARDWARE STORE ANYTOWN | $80.00",
  "Mar 20 | Mar 20 | PAYMENT THANK YOU | -$20.00",
];

const savingsScan = [
  "ANYTOWN SAVINGS BANK",
  "Statement Period : March 1, 2027 - March 31, 2027",
  "Account Summary 0000000000000",
  "Online Savings | XOOOOXXX1234 | $1,515.00",
  "anytownsavings.example/deposits",
  "03/01/2027 | Balance Last Statement | $1,000.00",
  "03/31/2027 | Closing Balance | $1,515.00",
  "Date | Transactions | Debits | Credits | Balance",
  "03/01/2027 | Beginning Balance | 1,000.00",
  "03/24/2027 | ACH Deposit | $500.00 | 1,500.00",
  "BN | 03/31/2027 | SAV Increase Int Paid | $15.00 | 1,515.00",
  "03/31/2027 | Closing Balance | 1,515.00",
];

describe("parseStatement", () => {
  it("reads a Capital One account across New Year, skipping lines that move no money", () => {
    const [s] = parseStatement(capitalOne);
    expect(s).toMatchObject({
      bank: "Capital One",
      kind: "deposit",
      accountName: "Everyday Savings",
      accountLast4: "1234",
      periodStart: "2026-12-15",
      periodEnd: "2027-01-14",
      openingBalance: 1000,
      closingBalance: 3099.5,
    });
    expect(s.rows).toEqual([
      { date: "2026-12-20", description: "Preauthorized Deposit from EMPLOYER checking account XXXX1234", amount: 2500 },
      { date: "2027-01-02", description: "Withdrawal to CHECKING", amount: -400.5 },
    ]);
    expect(statementDifference(s)).toBe(0);
  });

  it("reads Bank of America checking, joining descriptions that wrap", () => {
    const [s] = parseStatement(bofaChecking);
    expect(s).toMatchObject({
      kind: "deposit",
      accountLast4: "9012",
      periodStart: "2027-03-11",
      periodEnd: "2027-04-09",
      openingBalance: 1000,
      closingBalance: 1429.1,
    });
    expect(s.rows.map((r) => [r.date, r.amount])).toEqual([
      ["2027-03-16", 1200],
      ["2027-03-18", -70.9],
      ["2027-04-02", -700],
    ]);
    expect(s.rows[1].description).toBe("UTILITY CO DES:BILL ID:123 INDN:Jane Doe CO ID:000 PPD");
    expect(statementDifference(s)).toBe(0);
  });

  it("reads an unknown bank's signed amounts by their running balance", () => {
    const [s] = parseStatement(genericChecking);
    expect(s).toMatchObject({
      bank: "Other bank",
      kind: "deposit",
      accountLast4: "5678",
      periodStart: "2027-03-01",
      periodEnd: "2027-03-31",
      openingBalance: 1000,
      closingBalance: 1375.5,
    });
    expect(s.rows).toEqual([
      { date: "2027-03-02", description: "PAYROLL DEPOSIT", amount: 500 },
      { date: "2027-03-09", description: "ELECTRIC CO", amount: -124.5 },
    ]);
  });

  it("signs an unknown bank's unsigned amounts by the section they're under", () => {
    const [s] = parseStatement(genericSections);
    expect(s).toMatchObject({ accountLast4: "4321", periodStart: "2027-03-01", openingBalance: 200, closingBalance: 150 });
    expect(s.rows.map((r) => r.amount)).toEqual([100, -150]);
  });

  it("reads an unknown card by posting date, charges negative", () => {
    const [s] = parseStatement(genericCard);
    expect(s).toMatchObject({ kind: "card", accountLast4: "9999", periodStart: "2027-03-02", periodEnd: "2027-04-01" });
    expect(s.rows).toEqual([
      { date: "2027-03-06", description: "HARDWARE STORE ANYTOWN", amount: -80 },
      { date: "2027-03-20", description: "PAYMENT THANK YOU", amount: 20 },
    ]);
  });

  it("refuses an unknown bank's statement that its guesses can't balance", () => {
    expect(() => parseStatement(genericChecking.filter((l) => !l.includes("ELECTRIC")))).toThrow(/don't add up/);
  });

  it("reads a scanned savings statement by the best guess, past OCR's slips", () => {
    const [s] = parseStatement(savingsScan);
    expect(s).toMatchObject({
      bank: "Other bank",
      kind: "deposit",
      accountLast4: "1234",
      periodStart: "2027-03-01",
      periodEnd: "2027-03-31",
      openingBalance: 1000,
      closingBalance: 1515,
    });
    expect(s.rows).toEqual([
      { date: "2027-03-24", description: "ACH Deposit", amount: 500 },
      { date: "2027-03-31", description: "SAV Increase Int Paid", amount: 15 },
    ]);
  });

  it("reads Bank of America even when a transfer names Capital One", () => {
    const [s] = parseStatement([...bofaChecking, "Transfer to CAPITAL ONE"]);
    expect(s).toMatchObject({ bank: "Bank of America", kind: "deposit", accountLast4: "9012" });
  });

  it("reads a Bank of America card by posting date, charges negative, without reference numbers", () => {
    const [s] = parseStatement(bofaCard);
    expect(s).toMatchObject({ kind: "card", accountLast4: "9876", openingBalance: 200, closingBalance: 286.81 });
    expect(s.rows).toEqual([
      { date: "2027-01-10", description: "PAYMENT FROM CHK 9012 CONF#xyz", amount: 200 },
      { date: "2026-12-20", description: "TST*PIZZA PLACE Somewhere VT", amount: -86.81 },
      { date: "2026-12-31", description: "ELECTRIFY CANADA AJAX ON", amount: -200 },
    ]);
    expect(statementDifference(s)).toBe(0);
  });

  it("reports a misread statement by how far off it is", () => {
    const [s] = parseStatement(bofaChecking.filter((l) => !l.startsWith("04/02/27")));
    expect(statementDifference(s)).toBe(-700);
  });

  it("uses a plugin's reader, the bank named first winning", () => {
    const reader = { detect: /Anytown Credit Union/, read: () => [{ ...parseStatement(genericChecking)[0], bank: "Anytown CU" }] };
    expect(parseStatement(["Anytown Credit Union", ...genericChecking], [reader])[0].bank).toBe("Anytown CU");
    expect(parseStatement([...capitalOne, "Anytown Credit Union"], [reader])[0].bank).toBe("Capital One");
  });

  it("refuses a bank it doesn't know", () => {
    expect(() => parseStatement(["Some Other Bank", "Statement"])).toThrow(/isn't one FOQB can read/);
  });

  it("names what a best guess couldn't find", () => {
    expect(() => parseStatement(genericChecking.filter((l) => !/^Beginning balance/.test(l)))).toThrow(
      /Couldn't find the statement's opening balance$/,
    );
    expect(() => parseStatement(["Some Other Bank", "Statement"])).toThrow(
      /period, account number, opening balance or closing balance$/,
    );
  });
});

describe("pageLines", () => {
  const item = (str: string, x: number, y: number, width = str.length * 5) => ({ str, transform: [1, 0, 0, 1, x, y], width });

  it("rebuilds lines top to bottom, marking column gaps", () => {
    expect(
      pageLines([
        item("Amount", 300, 700),
        item("Date", 10, 700),
        item("09/16/26", 10, 680),
        item("Zelle", 70, 680.5),
        item("payment", 98, 680),
        item("3,800.00", 300, 680),
      ]),
    ).toEqual(["Date | Amount", "09/16/26 | Zelle payment | 3,800.00"]);
  });
});

describe("ocrLines", () => {
  const word = (text: string, x0: number, x1: number) => ({ text, bbox: { x0, x1 } });

  it("orders OCR lines top to bottom, marking column gaps", () => {
    expect(
      ocrLines(
        [
          { baseline: { y0: 300 }, words: [word("03/24/2027", 100, 250), word("ACH", 300, 350), word("Deposit", 362, 450), word("$500.00", 900, 1000)] },
          { baseline: { y0: 200 }, words: [word("Date", 100, 160), word("Transactions", 300, 480), word(" ", 500, 510)] },
        ],
        3,
      ),
    ).toEqual(["Date | Transactions", "03/24/2027 | ACH Deposit | $500.00"]);
  });
});

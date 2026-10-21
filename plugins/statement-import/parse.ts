// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Reads the transactions out of a bank statement's text lines (pageLines,
// columns joined with " | "). One reader per layout; each is checked by
// statementDifference, so a misread statement is refused, never booked.

export type StatementKind = "deposit" | "card";

export interface StatementRow {
  date: string; // YYYY-MM-DD, the day it posted
  description: string;
  // This app's sign: negative is money out of a deposit account, or a
  // charge on a card; positive is money in, or a payment or refund.
  amount: number;
}

export interface ParsedStatement {
  bank: string;
  kind: StatementKind;
  accountName: string;
  accountLast4: string;
  periodStart: string;
  periodEnd: string;
  // A deposit account's balance, or what's owed on a card.
  openingBalance: number;
  closingBalance: number;
  rows: StatementRow[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONEY = /^([+-])? ?\$?(-)?([\d,]*\.\d{2})$/;

export function parseMoney(text: string): number | null {
  const m = MONEY.exec(text.trim());
  if (!m) return null;
  const value = Number(m[3].replace(/,/g, "")); // ".06" too
  return m[1] === "-" || m[2] === "-" ? -value : value;
}

export function monthIndex(name: string): number {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  if (i < 0) throw new Error(`Unknown month "${name}"`);
  return i;
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// "Sep 1 - Sep 30, 2026", "August 19 - September 18, 2026": the start is
// in the year before when the period crosses New Year.
export function parseShortPeriod(text: string): { start: string; end: string; endYear: number; endMonth: number } | null {
  const m = /([A-Z][a-z]+) (\d{1,2}) - ([A-Z][a-z]+) (\d{1,2}), (\d{4})/.exec(text);
  if (!m) return null;
  const startMonth = monthIndex(m[1]);
  const endMonth = monthIndex(m[3]);
  const endYear = Number(m[5]);
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  return {
    start: isoDate(startYear, startMonth, Number(m[2])),
    end: isoDate(endYear, endMonth, Number(m[4])),
    endYear,
    endMonth,
  };
}

// A day without a year, in the statement period ending endMonth/endYear.
export function dateInPeriod(month: number, day: number, endYear: number, endMonth: number): string {
  return isoDate(month > endMonth ? endYear - 1 : endYear, month, day);
}

export function last4(digits: string): string {
  return digits.replace(/\D/g, "").slice(-4);
}

export function cells(line: string): string[] {
  return line.split(" | ").map((c) => c.trim());
}

function isCapitalOneRow(line: string): boolean {
  return /^[A-Z][a-z]{2} \d{1,2} \| /.test(line) || line.includes(" | ");
}

// Capital One 360: one statement can hold several accounts, each a table
// from "Opening Balance" to "Closing Balance" under its "Name - 3619...".
function parseCapitalOne(lines: string[]): ParsedStatement[] {
  const period = lines.map(parseShortPeriod).find((p) => p !== null);
  if (!period) throw new Error("Couldn't find the statement period");

  const statements: ParsedStatement[] = [];
  let accountName = "";
  let accountLast4 = "";
  let current: ParsedStatement | null = null;

  for (const [i, line] of lines.entries()) {
    const account = /^(.+?) - (\d{6,})$/.exec(line);
    if (account) {
      accountName = account[1];
      accountLast4 = last4(account[2]);
      continue;
    }
    const c = cells(line);
    const date = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(c[0]);
    if (!date) continue;
    const day = dateInPeriod(monthIndex(date[1]), Number(date[2]), period.endYear, period.endMonth);

    if (c[1] === "Opening Balance") {
      current = {
        bank: "Capital One",
        kind: "deposit",
        accountName,
        accountLast4,
        periodStart: period.start,
        periodEnd: period.end,
        openingBalance: parseMoney(c.at(-1)!) ?? 0,
        closingBalance: 0,
        rows: [],
      };
    } else if (c[1] === "Closing Balance" && current) {
      current.closingBalance = parseMoney(c.at(-1)!) ?? 0;
      statements.push(current);
      current = null;
    } else if (current && c.length >= 4) {
      // Date | Description | [Category] | +/- $Amount | $Balance. A line
      // with no amount (an interest rate change) moves no money.
      const amount = parseMoney(c.at(-2)!);
      if (amount === null || !/^[+-]/.test(c.at(-2)!)) continue;
      // A long description is printed on the lines just above and below
      // the row, which then has only Date | Category | Amount | Balance.
      const description =
        c.length === 4 ? [lines[i - 1], lines[i + 1]].filter((l) => l && !isCapitalOneRow(l)).join(" ") : c[1];
      current.rows.push({ date: day, description: description || c[1], amount });
    }
  }
  if (statements.length === 0) throw new Error("Couldn't find an account's opening and closing balance");
  return statements;
}

// Bank of America checking and savings: dated MM/DD/YY, signed amounts,
// descriptions that wrap onto the next line.
function parseBofaDeposit(lines: string[]): ParsedStatement {
  const text = lines.join("\n");
  const period = /for ([A-Z][a-z]+ \d{1,2}, \d{4}) to ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(text);
  const account = /Account (?:number:|#) ([\d ]*\d)/.exec(text);
  const opening = /Beginning balance on [^|\n]+\| (\S+)/.exec(text);
  const closing = /Ending balance on [^|\n]+\| (\S+)/.exec(text);
  if (!period || !account || !opening || !closing) throw new Error("Couldn't find the period, account or balances");

  const longDate = (s: string) => {
    const m = /([A-Z][a-z]+) (\d{1,2}), (\d{4})/.exec(s)!;
    return isoDate(Number(m[3]), monthIndex(m[1]), Number(m[2]));
  };

  const rows: StatementRow[] = [];
  let inTable = false;
  for (const line of lines) {
    const c = cells(line);
    const date = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(c[0]);
    const amount = c.length >= 3 ? parseMoney(c.at(-1)!) : null;
    if (date && amount !== null) {
      rows.push({
        date: isoDate(2000 + Number(date[3]), Number(date[1]) - 1, Number(date[2])),
        description: c.slice(1, -1).join(" "),
        amount,
      });
      inTable = true;
    } else if (/^Total |Account #|^Page \d+ of|^Date \| /i.test(line) || line.includes(" | ")) {
      inTable = false;
    } else if (inTable && rows.length > 0) {
      rows.at(-1)!.description += ` ${line}`;
    }
  }

  return {
    bank: "Bank of America",
    kind: "deposit",
    accountName: "Bank of America",
    accountLast4: last4(account[1]),
    periodStart: longDate(period[1]),
    periodEnd: longDate(period[2]),
    openingBalance: parseMoney(opening[1]) ?? 0,
    closingBalance: parseMoney(closing[1]) ?? 0,
    rows,
  };
}

// Bank of America credit cards: transaction and posting dates (MM/DD), then
// the description, reference and account numbers, and an amount that's
// positive for a charge.
function parseBofaCard(lines: string[]): ParsedStatement {
  const text = lines.join("\n");
  const period = lines.map(parseShortPeriod).find((p) => p !== null);
  const account = /Account ?# ([\d ]*\d)/.exec(text);
  const opening = /Previous Balance \| (\S+)/.exec(text);
  const closing = /New Balance Total \| (\S+)/.exec(text);
  if (!period || !account || !opening || !closing) throw new Error("Couldn't find the period, account or balances");

  const rows: StatementRow[] = [];
  for (const line of lines) {
    const c = cells(line);
    const posted = c.length >= 4 && /^\d{2}\/\d{2}$/.test(c[0]) ? /^(\d{2})\/(\d{2})$/.exec(c[1]) : null;
    const amount = posted ? parseMoney(c.at(-1)!) : null;
    if (!posted || amount === null || amount === 0) continue;
    let description = c.slice(2, -1);
    if (description.length >= 3 && description.slice(-2).every((d) => /^\d{4}$/.test(d))) description = description.slice(0, -2);
    rows.push({
      date: dateInPeriod(Number(posted[1]) - 1, Number(posted[2]), period.endYear, period.endMonth),
      description: description.join(" "),
      amount: -amount,
    });
  }

  return {
    bank: "Bank of America",
    kind: "card",
    accountName: "Bank of America Card",
    accountLast4: last4(account[1]),
    periodStart: period.start,
    periodEnd: period.end,
    openingBalance: parseMoney(opening[1]) ?? 0,
    closingBalance: parseMoney(closing[1]) ?? 0,
    rows,
  };
}

// Any other bank: a best guess at the usual shape, rows that start with a
// date and carry an amount, between an opening and a closing balance. The
// sign of each amount is guessed several ways (as printed, by the section
// it's under, from a running balance column) and the guess kept is the one
// that adds up to the closing balance; none adding up is refused.
const DATE_CELL = [
  /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=\s|$)/,
  /^(\d{1,2})-(\d{1,2})(?:-(\d{2}|\d{4}))?(?=\s|$)/,
  /^([A-Z][a-z]{2})\.? (\d{1,2})(?:,? (\d{4}))?(?=\s|$)/,
];
const DATE_RANGE = [
  /(\d{1,2}\/\d{1,2}\/\d{2,4}) ?(?:-|–|to|through|thru) ?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  /([A-Z][a-z]+\.? \d{1,2},? \d{4}) ?(?:-|–|to|through|thru) ?([A-Z][a-z]+\.? \d{1,2},? \d{4})/i,
];
const OPENING = /\b(beginning|opening|previous|starting|prior)\b[^|]*balance|balance (last statement|forward|brought forward)/i;
const CLOSING = /\b(ending|closing|new|current)\b[^|]*balance|balance this statement|statement balance/i;
const MONEY_IN = /deposit|credit|addition|payments? (received|and credits)/i;
const MONEY_OUT = /withdrawal|debit|subtraction|checks? paid|purchase|charge|fee/i;

interface DatedCell {
  month: number;
  day: number;
  year: number | null;
  rest: string;
}

function datedCell(cell: string): DatedCell | null {
  for (const [i, re] of DATE_CELL.entries()) {
    const m = re.exec(cell);
    if (!m) continue;
    const month = i === 2 ? MONTHS.indexOf(m[1].toLowerCase()) : Number(m[1]) - 1;
    const day = Number(m[2]);
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    const year = m[3] ? Number(m[3]) + (m[3].length === 2 ? 2000 : 0) : null;
    return { month, day, year, rest: cell.slice(m[0].length).replace(/^[\s'*]+/, "") };
  }
  return null;
}

function anyDate(text: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text);
  if (m) return isoDate(Number(m[3]) + (m[3].length === 2 ? 2000 : 0), Number(m[1]) - 1, Number(m[2]));
  const l = /^([A-Z][a-z]+)\.? (\d{1,2}),? (\d{4})$/i.exec(text)!;
  return isoDate(Number(l[3]), monthIndex(l[1]), Number(l[2]));
}

// The amount on a balance line: the first money after its label.
function balanceOn(lines: string[], label: RegExp): number | null {
  for (const line of lines) {
    const c = cells(line);
    const at = c.findIndex((cell) => label.test(cell));
    if (at < 0) continue;
    const tail = c[at].split(" ").at(-1)!;
    for (const cell of [tail, ...c.slice(at + 1)]) {
      const amount = parseMoney(cell.replace(/^=\s*/, ""));
      if (amount !== null) return amount;
    }
  }
  return null;
}

interface RawRow {
  dates: string[];
  description: string;
  amounts: number[];
  section: number; // +1 under a money-in heading, -1 money-out, 0 neither
}

export function parseGeneric(lines: string[], bank = "Other bank"): ParsedStatement {
  const text = lines.join("\n");
  const range = DATE_RANGE.map((re) => re.exec(text)).find((m) => m !== null);
  const short = range ? null : lines.map(parseShortPeriod).find((p) => p !== null);
  const periodStart = range ? anyDate(range[1]) : short?.start;
  const periodEnd = range ? anyDate(range[2]) : short?.end;
  // "Account number: 1234 5678", or a masked "xxxxxxx1234" (OCR reads some
  // of those x's as o's and zeros). A long run of one digit is OCR reading
  // a ruled line, not a number.
  const accountNumber = [
    ...text.matchAll(/(?:account|acct)[^\n\d]{0,30}?([\dX*•. -]*\d{4})\b/gi),
    ...text.matchAll(/(?:^|[\s|])([xX*•][xX*•0oO]{2,}\d{4})\b/gm),
  ]
    .map((m) => m[1])
    .find((n) => !/^(\d)\1{6,}$/.test(n.replace(/\D/g, "")));
  const opening = balanceOn(lines, OPENING);
  const closing = balanceOn(lines, CLOSING);
  if (!periodStart || !periodEnd || !accountNumber || opening === null || closing === null) {
    throw new Error("Couldn't find the period, account or balances");
  }
  const endYear = Number(periodEnd.slice(0, 4));
  const endMonth = Number(periodEnd.slice(5, 7)) - 1;
  const iso = (d: DatedCell) => (d.year ? isoDate(d.year, d.month, d.day) : dateInPeriod(d.month, d.day, endYear, endMonth));

  const raw: RawRow[] = [];
  let section = 0;
  for (const line of lines) {
    let c = cells(line);
    // A scan's margin (a barcode) can read as a scrap of text before the date.
    if (c.length > 2 && c[0].length <= 3 && !datedCell(c[0]) && datedCell(c[1])) c = c.slice(1);
    const first = datedCell(c[0]);
    if (!first) {
      if (!/\d\.\d{2}/.test(line) && line.length < 60) {
        section = MONEY_OUT.test(line) ? -1 : MONEY_IN.test(line) ? 1 : section;
      }
      continue;
    }
    const dates = [iso(first)];
    const words: string[] = first.rest ? [first.rest] : [];
    const amounts: number[] = [];
    for (const cell of c.slice(1)) {
      const date = datedCell(cell);
      const amount = parseMoney(cell.replace(/^=\s*/, ""));
      if (amount !== null) amounts.push(amount);
      else if (date && !date.rest && dates.length === 1 && words.length === 0) dates.push(iso(date));
      else if (amounts.length === 0) words.push(cell);
    }
    const description = words.join(" ").trim();
    if (amounts.length === 0 || !/[A-Za-z]{2}/.test(description) || /balance/i.test(description)) continue;
    raw.push({ dates, description, amounts, section });
  }

  const card = /minimum payment|credit limit|available credit/i.test(text);
  const base = { bank, accountLast4: last4(accountNumber), periodStart, periodEnd, openingBalance: opening, closingBalance: closing };
  for (const kind of card ? (["card", "deposit"] as const) : (["deposit", "card"] as const)) {
    for (const dateAt of [1, 0]) {
      for (const rows of signGuesses(raw, dateAt, kind, opening)) {
        const statement: ParsedStatement = { ...base, kind, accountName: kind === "card" ? "Card" : "Account", rows };
        if (rows.length > 0 && statementDifference(statement) === 0) return statement;
      }
    }
  }
  throw new Error("Found transactions, but they don't add up to the closing balance");
}

// The ways a row's amount could be signed, in this app's sign.
function signGuesses(raw: RawRow[], dateAt: number, kind: StatementKind, opening: number): StatementRow[][] {
  const row = (r: RawRow, amount: number): StatementRow => ({
    date: r.dates[Math.min(dateAt, r.dates.length - 1)],
    description: r.description,
    amount,
  });
  // A card prints a charge positive; this app's is negative.
  const printed = kind === "card" ? -1 : 1;
  const guesses = [
    raw.map((r) => row(r, printed * r.amounts[0])),
    raw.map((r) => row(r, -printed * r.amounts[0])),
    raw.map((r) => row(r, (r.section || printed) * Math.abs(r.amounts[0]))),
  ];
  // Amount then running balance: the change in the balance is the amount.
  if (raw.every((r) => r.amounts.length >= 2)) {
    let balance = opening;
    guesses.push(
      raw.map((r) => {
        const next = r.amounts.at(-1)!;
        const change = Math.round((next - balance) * 100) / 100;
        balance = next;
        return row(r, kind === "card" ? -change : change);
      }),
    );
  }
  return guesses.map((rows) => rows.filter((r) => r.amount !== 0));
}

// A reader for one bank's layout. detect finds the bank in the text; when
// several readers match, the bank named first wins, since another bank can
// turn up later in a transfer's or payment's description.
export interface StatementReader {
  detect: RegExp;
  read: (lines: string[]) => ParsedStatement[];
}

const READERS: StatementReader[] = [
  { detect: /capitalone\.com|Capital One/i, read: (lines) => parseCapitalOne(lines) },
  {
    detect: /bankofamerica\.com|Bank of America/i,
    read: (lines) => [/New Balance Total/.test(lines.join("\n")) ? parseBofaCard(lines) : parseBofaDeposit(lines)],
  },
];

// The built-in readers plus any a plugin adds (statementReaders), then the
// best guess.
export function parseStatement(lines: string[], extra: StatementReader[] = []): ParsedStatement[] {
  const text = lines.join("\n");
  const found = [...READERS, ...extra]
    .map((reader) => ({ reader, at: text.search(reader.detect) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (found) return found.reader.read(lines);
  try {
    return [parseGeneric(lines)];
  } catch (err) {
    throw new Error(
      `This statement's layout isn't one FOQB can read yet (Capital One and Bank of America so far), and a best guess failed: ${(err as Error).message}`,
    );
  }
}

// What the rows leave unexplained: zero when opening + rows = closing. A
// card's balance is what's owed, so a charge (negative) adds to it.
export function statementDifference(s: Pick<ParsedStatement, "kind" | "openingBalance" | "closingBalance" | "rows">): number {
  const total = s.rows.reduce((sum, r) => sum + r.amount, 0);
  const expected = s.kind === "card" ? s.openingBalance - total : s.openingBalance + total;
  return Math.round((s.closingBalance - expected) * 100) / 100;
}

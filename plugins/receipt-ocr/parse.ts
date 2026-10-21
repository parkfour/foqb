// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pulls a bill's details out of a receipt's text (from OCR or a PDF's text
// layer). Only reports what it actually found: a field it can't read is
// left out, never guessed, because whatever it returns lands in someone's
// books once they click Save.

export interface ParsedReceipt {
  vendorName?: string;
  date?: string; // YYYY-MM-DD
  receiptNumber?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  // Present only when the items, plus tax, add up to the total.
  items?: { description: string; quantity: number; unitPrice: number }[];
}

// ponytail: US-style receipts (12.34, MM/DD/YYYY); add locale rules when
// someone scans receipts in another format.
const AMOUNT = /(-?)\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NOT_ITEMS =
  /\b(sub\s*-?total|total|tax|vat|gst|balance|change|cash|tender|tendered|visa|mastercard|amex|discover|debit|credit|card|payment|paid|tip|gratuity|due|savings|discount|you saved|rounding)\b/i;
const NOT_VENDOR = /\b(receipt|invoice|welcome|thank|order|customer copy|merchant copy|tel|phone|www\.|http)\b/i;

function amountsIn(line: string): number[] {
  return [...line.matchAll(AMOUNT)].map((m) => {
    const value = Number(`${m[2].replace(/,/g, "")}.${m[3]}`);
    return m[1] ? -value : value;
  });
}

function lastAmount(line: string): number | undefined {
  return amountsIn(line).at(-1);
}

function isoDate(year: number, month: number, day: number): string | undefined {
  const y = year < 100 ? 2000 + year : year;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return d.toISOString().slice(0, 10);
}

export function findDate(text: string): string | undefined {
  const patterns: [RegExp, (m: RegExpMatchArray) => string | undefined][] = [
    [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) => isoDate(+m[1], +m[2], +m[3])],
    [/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/, (m) => isoDate(+m[3], +m[1], +m[2])],
    [
      /\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i,
      (m) => (MONTHS.includes(m[1].toLowerCase()) ? isoDate(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]) : undefined),
    ],
    [
      /\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})\b/i,
      (m) => (MONTHS.includes(m[2].toLowerCase()) ? isoDate(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]) : undefined),
    ],
  ];
  for (const [pattern, toDate] of patterns) {
    for (const m of text.matchAll(new RegExp(pattern, "gi"))) {
      const date = toDate(m);
      if (date) return date;
    }
  }
  return undefined;
}

function findTotal(lines: string[]): number | undefined {
  // The most specific label wins; within a label, the last line (a receipt's
  // final total comes after any running ones).
  const labels = [/\b(grand\s+total|amount\s+due|balance\s+due|total\s+due)\b/i, /^(?!.*sub\s*-?total).*\btotal\b/i];
  for (const label of labels) {
    const amount = lines.filter((l) => label.test(l)).map(lastAmount).filter((a) => a !== undefined).at(-1);
    if (amount !== undefined) return amount;
  }
  return undefined;
}

function findLabeled(lines: string[], label: RegExp): number | undefined {
  return lines.filter((l) => label.test(l)).map(lastAmount).find((a) => a !== undefined);
}

function findItems(lines: string[]): ParsedReceipt["items"] {
  const items: NonNullable<ParsedReceipt["items"]> = [];
  for (const line of lines) {
    if (NOT_ITEMS.test(line)) continue;
    const amounts = amountsIn(line);
    if (amounts.length === 0) continue;
    const description = line
      .replace(AMOUNT, "")
      .replace(/\b\d+\s*[x@]\s*/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!/[a-z]{2}/i.test(description)) continue;

    const amount = amounts.at(-1) as number;
    // "2 x 3.50  7.00" or "2 @ 3.50  7.00"
    const qty = line.match(/\b(\d+)\s*[x@]\s*\$?\d/i);
    const quantity = qty ? Number(qty[1]) : 1;
    const unitPrice = qty && amounts.length >= 2 ? amounts[0] : Math.round((amount / quantity) * 100) / 100;
    items.push({ description, quantity, unitPrice });
  }
  return items;
}

const cents = (n: number) => Math.round(n * 100);

export function parseReceipt(text: string): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const result: ParsedReceipt = {};

  const vendor = lines.slice(0, 5).find((l) => /[a-z]{3}/i.test(l) && !NOT_VENDOR.test(l) && amountsIn(l).length === 0);
  if (vendor) result.vendorName = vendor.replace(/\s{2,}/g, " ");

  const date = findDate(text);
  if (date) result.date = date;

  const number = text.match(/\b(?:receipt|invoice|order|ticket|trans(?:action)?)\s*(?:no\.?|number|num|#)\s*[:#]?\s*([a-z0-9][a-z0-9-]{2,})/i);
  if (number) result.receiptNumber = number[1];

  const subtotal = findLabeled(lines, /\bsub\s*-?total\b/i);
  const tax = findLabeled(lines, /\b(sales\s+)?(tax|vat|gst)\b/i);
  const total = findTotal(lines);
  if (subtotal !== undefined) result.subtotal = subtotal;
  if (tax !== undefined) result.tax = tax;
  if (total !== undefined) result.total = total;

  const items = findItems(lines);
  if (total !== undefined && items && items.length > 0) {
    const sum = items.reduce((s, i) => s + cents(i.quantity * i.unitPrice), 0) + cents(tax ?? 0);
    if (sum === cents(total)) result.items = items;
  }
  return result;
}

// The vendor whose name appears near the top of the receipt, if exactly one
// does; otherwise none, and the person picks.
export function matchVendor<V extends { id: string; name: string }>(text: string, vendors: V[]): V | undefined {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const top = normalize(text.split(/\r?\n/).slice(0, 6).join(" "));
  const found = vendors.filter((v) => {
    const name = normalize(v.name);
    return name.length >= 3 && top.includes(name);
  });
  // "Acme Hardware" on the receipt also contains "Acme": keep the longer.
  const matches = found.filter(
    (v) => !found.some((o) => o !== v && normalize(o.name).length > normalize(v.name).length && normalize(o.name).includes(normalize(v.name))),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

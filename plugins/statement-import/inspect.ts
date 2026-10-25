// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseMoney } from "./parse";

export type TagCategory =
  | "date"
  | "amount"
  | "account"
  | "balance"
  | "institution"
  | "description"
  | "section"
  | "transaction";

export interface DocumentTag {
  text: string;
  tag: string;
  category: TagCategory;
  confidence?: "high" | "medium" | "low";
}

export interface TaggedLine {
  lineNumber: number;
  rawText: string;
  tags: DocumentTag[];
  isTransactionCandidate?: boolean;
}

export interface DetectedTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  rawLine: string;
  selected?: boolean;
}

export interface DocumentInspection {
  detectedBank: string | null;
  detectedAccountLast4: string | null;
  detectedPeriod: { start: string; end: string } | null;
  openingBalance: number | null;
  closingBalance: number | null;
  candidateTransactions: DetectedTransaction[];
  taggedLines: TaggedLine[];
  rawLinesCount: number;
}

const KNOWN_INSTITUTIONS = [
  { name: "Capital One", pattern: /capital\s*one/i },
  { name: "Bank of America", pattern: /bank\s*of\s*america|bofa\b/i },
  { name: "Chase", pattern: /chase\b|jpmorgan/i },
  { name: "Wells Fargo", pattern: /wells\s*fargo/i },
  { name: "Citibank", pattern: /citi(?:bank)?\b/i },
  { name: "PNC Bank", pattern: /pnc(?:\s*bank)?\b/i },
  { name: "US Bank", pattern: /u\.?s\.?\s*bank\b/i },
  { name: "TD Bank", pattern: /td\s*bank\b/i },
  { name: "Discover", pattern: /discover(?:\s*bank)?\b/i },
  { name: "American Express", pattern: /american\s*express|amex\b/i },
  { name: "Charles Schwab", pattern: /charles\s*schwab|schwab\b/i },
  { name: "Fidelity", pattern: /fidelity/i },
  { name: "Navy Federal", pattern: /navy\s*federal/i },
  { name: "USAA", pattern: /usaa\b/i },
  { name: "Barclays", pattern: /barclays/i },
];

const DATE_REGEX =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?)\b/gi;

const MONEY_REGEX = /[-+]?\$?\d{1,3}(?:,\d{3})*\.\d{2}\b/g;

export function inspectStatementDocument(lines: string[]): DocumentInspection {
  const fullText = lines.join("\n");
  let detectedBank: string | null = null;
  for (const inst of KNOWN_INSTITUTIONS) {
    if (inst.pattern.test(fullText)) {
      detectedBank = inst.name;
      break;
    }
  }

  // Account last 4 detection
  let detectedAccountLast4: string | null = null;
  const acctMatches = [
    ...fullText.matchAll(/(?:account|acct|ending in|card)[^\n\d]{0,25}?([xX*•. -]*\d{4})\b/gi),
    ...fullText.matchAll(/\b([xX*•]{2,}\d{4})\b/g),
  ];
  for (const match of acctMatches) {
    const rawDigits = match[1].replace(/\D/g, "");
    if (rawDigits.length >= 4) {
      detectedAccountLast4 = rawDigits.slice(-4);
      break;
    }
  }

  // Period detection
  let detectedPeriod: { start: string; end: string } | null = null;
  const periodMatch =
    /(?:statement\s+period|period|billing\s+cycle)[:\s]+([A-Za-z0-9/., -]+(?:to|-)[A-Za-z0-9/., -]+)/i.exec(
      fullText,
    );
  if (periodMatch) {
    const dates = periodMatch[1].match(DATE_REGEX);
    if (dates && dates.length >= 2) {
      detectedPeriod = { start: dates[0], end: dates[1] };
    }
  }

  // Balances detection
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;

  for (const line of lines) {
    if (/previous|opening|starting|beginning/i.test(line) && /balance/i.test(line)) {
      const amounts = line.match(MONEY_REGEX);
      if (amounts && amounts.length > 0 && openingBalance === null) {
        openingBalance = parseMoney(amounts[0]);
      }
    }
    if (/ending|closing|new|current/i.test(line) && /balance/i.test(line)) {
      const amounts = line.match(MONEY_REGEX);
      if (amounts && amounts.length > 0 && closingBalance === null) {
        closingBalance = parseMoney(amounts[amounts.length - 1]);
      }
    }
  }

  const taggedLines: TaggedLine[] = [];
  const candidateTransactions: DetectedTransaction[] = [];
  let txIdCounter = 1;

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx].trim();
    if (!rawLine) continue;

    const tags: DocumentTag[] = [];

    // Tag institution if present
    for (const inst of KNOWN_INSTITUTIONS) {
      if (inst.pattern.test(rawLine)) {
        tags.push({ text: inst.name, tag: "Institution / Bank", category: "institution" });
        break;
      }
    }

    // Tag opening or closing balance markers
    if (/previous|opening|starting|beginning/i.test(rawLine) && /balance/i.test(rawLine)) {
      tags.push({ text: "Opening Balance", tag: "Opening Balance", category: "balance" });
    } else if (/ending|closing|new|current/i.test(rawLine) && /balance/i.test(rawLine)) {
      tags.push({ text: "Closing Balance", tag: "Closing Balance", category: "balance" });
    }

    // Tag dates
    const dateMatches = [...rawLine.matchAll(DATE_REGEX)];
    for (const dm of dateMatches) {
      tags.push({ text: dm[0], tag: "Date", category: "date" });
    }

    // Tag amounts
    const moneyMatches = [...rawLine.matchAll(MONEY_REGEX)];
    for (const mm of moneyMatches) {
      tags.push({ text: mm[0], tag: "Amount", category: "amount" });
    }

    // Tag account number
    if (/account|acct|ending/i.test(rawLine)) {
      const numMatch = rawLine.match(/\b([xX*•. -]*\d{4})\b/);
      if (numMatch) {
        tags.push({ text: numMatch[1], tag: "Account #", category: "account" });
      }
    }

    // Identify transaction candidates
    // A transaction candidate typically has at least one date, one amount, and some textual description
    const isCandidate =
      dateMatches.length >= 1 &&
      moneyMatches.length >= 1 &&
      !/balance|summary|total|interest charge|payment due/i.test(rawLine);

    if (isCandidate) {
      tags.push({ text: rawLine, tag: "Transaction Candidate", category: "transaction" });

      const dateStr = dateMatches[0][0];
      const parsedAmt = parseMoney(moneyMatches[0][0]) ?? 0;

      // Extract description by stripping dates and amounts
      let desc = rawLine;
      for (const dm of dateMatches) desc = desc.replace(dm[0], " ");
      for (const mm of moneyMatches) desc = desc.replace(mm[0], " ");
      desc = desc.replace(/\|\s*/g, " ").replace(/\s{2,}/g, " ").trim();
      if (!desc) desc = "Imported Transaction";

      candidateTransactions.push({
        id: `candidate_${txIdCounter++}`,
        date: dateStr,
        description: desc,
        amount: parsedAmt,
        rawLine,
        selected: true,
      });
    }

    // Save tagged line if it has any meaningful tags
    if (tags.length > 0) {
      taggedLines.push({
        lineNumber: idx + 1,
        rawText: rawLine,
        tags,
        isTransactionCandidate: isCandidate,
      });
    }
  }

  return {
    detectedBank,
    detectedAccountLast4,
    detectedPeriod,
    openingBalance,
    closingBalance,
    candidateTransactions,
    taggedLines,
    rawLinesCount: lines.length,
  };
}

// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A fixed-rate, fully amortizing note paid monthly.

export interface NoteTerms {
  originalPrincipal: number;
  annualRate: number; // percent, e.g. 6.5
  paymentAmount: number; // principal and interest, without escrow
  firstPaymentDate: string; // YYYY-MM-DD
}

export interface PaymentSplit {
  interest: number;
  principal: number;
  escrow: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// One month's interest on the balance owed.
export function monthlyInterest(balance: number, annualRate: number): number {
  return round2((balance * annualRate) / 100 / 12);
}

// The level monthly payment that pays principal off over termMonths.
export function levelPayment(principal: number, annualRate: number, termMonths: number): number {
  const r = annualRate / 100 / 12;
  if (r === 0) return round2(principal / termMonths);
  return round2((principal * r) / (1 - (1 + r) ** -termMonths));
}

// What a payment received pays, in order: the month's interest on what's
// owed, then the escrow due, then principal. A short payment pays as far
// down that list as it goes; anything extra pays down principal.
// ponytail: interest is one month's per payment, as on the schedule; a
// missed month isn't charged twice (a lender who does needs daily accrual).
export function splitPayment(amount: number, balance: number, annualRate: number, escrowDue: number): PaymentSplit {
  const interest = Math.min(monthlyInterest(Math.max(balance, 0), annualRate), round2(amount));
  const escrow = Math.min(escrowDue, round2(amount - interest));
  return { interest, escrow, principal: round2(amount - interest - escrow) };
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// The balance owed by the schedule after every payment due on or before
// asOf, as if each was paid on time and in full.
export function scheduledBalance(terms: NoteTerms, asOf: string): number {
  let balance = terms.originalPrincipal;
  for (let n = 0; balance > 0; n++) {
    if (addMonths(terms.firstPaymentDate, n) > asOf) break;
    const interest = monthlyInterest(balance, terms.annualRate);
    balance = round2(balance - Math.min(terms.paymentAmount - interest, balance));
  }
  return balance;
}

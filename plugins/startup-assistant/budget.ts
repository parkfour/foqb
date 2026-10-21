// SPDX-FileCopyrightText: 2026 Park Four, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The starting budget "All done" offers a household: each expense account's
// average monthly spending over the months the books now cover, budgeted
// the same in each of those months.

// More than this many months is a typo, not a timeframe.
export const MAX_BUDGET_MONTHS = 36;

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function monthIndex(yearMonth: string): number {
  const m = YEAR_MONTH.exec(yearMonth);
  if (!m) throw new Error(`Not a month: ${yearMonth}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

function yearMonthOf(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// Every month from `from` to `to`, both included ("YYYY-MM").
export function monthsBetween(from: string, to: string): string[] {
  const start = monthIndex(from);
  const end = monthIndex(to);
  if (end < start) throw new Error("The last month is before the first");
  if (end - start + 1 > MAX_BUDGET_MONTHS) throw new Error(`At most ${MAX_BUDGET_MONTHS} months`);
  return Array.from({ length: end - start + 1 }, (_, i) => yearMonthOf(start + i));
}

// The whole months the books cover: from the first month after the
// earliest opening balance (a December 31 opening starts in January) to the
// last month finished before today. Null when there isn't one yet.
export function budgetTimeframe(startsOn: string[], today: string): { from: string; to: string } | null {
  if (startsOn.length === 0) return null;
  const earliest = [...startsOn].sort()[0];
  const from = monthIndex(earliest.slice(0, 7)) + 1;
  const to = monthIndex(today.slice(0, 7)) - 1;
  if (to < from) return null;
  return { from: yearMonthOf(Math.max(from, to - MAX_BUDGET_MONTHS + 1)), to: yearMonthOf(to) };
}

// Each expense account's spending over the timeframe, as a whole-dollar
// monthly amount; accounts that spent nothing (or were refunded more than
// they spent) get no budget.
export function averageSpending(
  rows: { account_id: string; type: string; amount: number | string }[],
  months: number,
): { accountId: string; monthly: number }[] {
  return rows
    .filter((r) => r.type === "expense")
    .map((r) => ({ accountId: r.account_id, monthly: Math.round(Number(r.amount) / months) }))
    .filter((r) => r.monthly > 0);
}

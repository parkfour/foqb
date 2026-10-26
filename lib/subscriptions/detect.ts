// Recurring charges in the bank feed: the same merchant, money going out,
// at a steady rhythm (weekly, monthly or yearly) and a steady amount.
// Found from what's already there; nothing is stored.

export interface FeedCharge {
  date: string;
  name: string;
  amount: number; // negative: money out
}

export type Cadence = "weekly" | "monthly" | "yearly";

export interface RecurringCharge {
  merchant: string;
  cadence: Cadence;
  typical: number; // positive, the median charge
  count: number;
  last: string;
  next: string;
  perYear: number;
}

const CADENCES: { cadence: Cadence; days: number; slack: number; perYear: number }[] = [
  { cadence: "weekly", days: 7, slack: 2, perYear: 52 },
  { cadence: "monthly", days: 30.44, slack: 5, perYear: 12 },
  { cadence: "yearly", days: 365.25, slack: 15, perYear: 1 },
];

// "NETFLIX.COM 866-579 CA #1234" and "Netflix.com" are one merchant: case,
// digits, punctuation, store numbers and two-letter words (states) drop
// out; the first two words stay.
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["com", "www", "inc", "llc", "pos", "ach", "debit", "purchase"].includes(w))
    .slice(0, 2)
    .join(" ");
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + Math.round(days)) * 86_400_000).toISOString().slice(0, 10);
}

export function detectRecurring(charges: FeedCharge[], minCount = 3): RecurringCharge[] {
  const groups = new Map<string, { name: string; charges: FeedCharge[] }>();
  for (const c of charges) {
    if (c.amount >= 0) continue;
    const key = merchantKey(c.name);
    if (!key) continue;
    const g = groups.get(key) ?? { name: c.name, charges: [] };
    g.charges.push(c);
    groups.set(key, g);
  }

  const found: RecurringCharge[] = [];
  for (const { name, charges: list } of groups.values()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((c) => -c.amount);
    const typical = median(amounts);
    // Steady amount: most charges within 20% of the median.
    const steady = amounts.filter((a) => Math.abs(a - typical) <= typical * 0.2).length;
    if (steady < Math.max(2, Math.ceil(amounts.length * 0.75))) continue;

    const gaps = sorted.slice(1).map((c, i) => dayNumber(c.date) - dayNumber(sorted[i].date));
    const gap = median(gaps);
    const match = CADENCES.find((c) => Math.abs(gap - c.days) <= c.slack);
    // A year needs only two charges; the others need minCount.
    if (!match || sorted.length < (match.cadence === "yearly" ? 2 : minCount)) continue;

    const last = sorted[sorted.length - 1].date;
    found.push({
      merchant: name,
      cadence: match.cadence,
      typical: Math.round(typical * 100) / 100,
      count: sorted.length,
      last,
      next: addDays(last, match.days),
      perYear: Math.round(typical * match.perYear * 100) / 100,
    });
  }
  return found.sort((a, b) => b.perYear - a.perYear);
}

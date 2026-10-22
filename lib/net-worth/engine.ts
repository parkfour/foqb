import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/time/book-time";

export interface NetWorthBreakdown {
  cash: number;
  investments: number;
  real_estate: number;
  vehicles: number;
  credit_cards: number;
  mortgages: number;
  loans: number;
  other_liabilities?: number;
}

export type NetWorthBucket = keyof NetWorthBreakdown;

// One account or property behind a breakdown figure, for the dashboard to
// list what's in each total.
export interface NetWorthItem {
  bucket: NetWorthBucket;
  name: string;
  amount: number;
  href: string;
}

export interface NetWorthSnapshotData {
  id?: string;
  organizationId: string;
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  breakdown: NetWorthBreakdown;
  // What's in each bucket (not stored with the snapshot).
  items?: NetWorthItem[];
}

export function computeNetWorth(assets: number, liabilities: number): number {
  return Math.round((assets - liabilities) * 100) / 100;
}

// Which net worth bucket an account falls in, from its name; the chart of
// accounts has no finer type than asset/liability. An account whose name
// doesn't say is cash, or a credit card if owed, when a bank feeds it.
const CASH = /\b(cash|checking|savings|money market)\b/i;
const INVESTMENTS = /\b(invest\w*|brokerage|ira|roth|hsa|stocks?|bonds?)\b|\b(401|403|457) ?\(?[kb]\)?/i;
const REAL_ESTATE = /\b(real estate|property|properties|home|house)\b/i;
const CREDIT_CARDS = /\b(credit|cards?)\b/i;
const MORTGAGES = /\bmortgages?\b/i;
const LOANS = /\bloans?\b/i;

const round = (n: number) => Math.round(n * 100) / 100;

function bucketOf(row: { account_number: string; name: string; type: string }, bankFed: boolean): NetWorthBucket | null {
  if (row.type === "asset") {
    if (CASH.test(row.name) || row.account_number?.startsWith("10")) return "cash";
    if (INVESTMENTS.test(row.name)) return "investments";
    if (bankFed) return "cash";
    if (REAL_ESTATE.test(row.name)) return "real_estate";
    return "vehicles";
  }
  if (row.type === "liability") {
    if (MORTGAGES.test(row.name)) return "mortgages";
    if (CREDIT_CARDS.test(row.name)) return "credit_cards";
    if (LOANS.test(row.name)) return "loans";
    return bankFed ? "credit_cards" : "other_liabilities";
  }
  return null;
}

// Household-only figures: account balances (computed in the database by
// get_balance_sheet, so there's no row limit) plus properties' estimated
// values. Business equity is shown separately by the dashboard.
// `today` is the book's date (bookToday), not the server's.
export async function calculateHouseholdNetWorth(
  orgId: string,
  today: string,
  supabaseClient?: Awaited<ReturnType<typeof createClient>>,
): Promise<NetWorthSnapshotData> {
  const supabase = supabaseClient ?? (await createClient());

  const [{ data: balances, error }, { data: properties }, { data: fed }] = await Promise.all([
    supabase.rpc("get_balance_sheet", { p_org_id: orgId, p_as_of_date: today }),
    supabase.from("properties").select("name, estimated_value, purchase_price").eq("organization_id", orgId),
    supabase.from("accounts").select("id").eq("organization_id", orgId).eq("has_bank_feed", true),
  ]);
  const bankFed = new Set(((fed ?? []) as { id: string }[]).map((a) => a.id));
  if (error) throw new Error(`Failed to load account balances: ${error.message}`);

  const breakdown: NetWorthBreakdown = {
    cash: 0,
    investments: 0,
    real_estate: 0,
    vehicles: 0,
    credit_cards: 0,
    mortgages: 0,
    loans: 0,
    other_liabilities: 0,
  };

  const items: NetWorthItem[] = [];
  const add = (item: NetWorthItem) => {
    breakdown[item.bucket] = (breakdown[item.bucket] ?? 0) + item.amount;
    if (item.amount !== 0) items.push({ ...item, amount: round(item.amount) });
  };

  // Balances are positive on each account's normal side (debit for assets,
  // credit for liabilities); an overdrawn account stays negative.
  for (const row of (balances ?? []) as { account_id: string | null; account_number: string; name: string; type: string; balance: number | string }[]) {
    if (!row.account_id) continue;
    const bucket = bucketOf(row, bankFed.has(row.account_id));
    if (bucket) add({ bucket, name: row.name, amount: Number(row.balance), href: `/reports/account/${row.account_id}?from=networth` });
  }

  for (const p of (properties ?? []) as { name: string | null; estimated_value: number | string | null; purchase_price: number | string | null }[]) {
    add({ bucket: "real_estate", name: p.name ?? "Property", amount: Number(p.estimated_value ?? p.purchase_price ?? 0), href: "/properties" });
  }

  for (const key of Object.keys(breakdown) as (keyof NetWorthBreakdown)[]) {
    breakdown[key] = round(breakdown[key] ?? 0);
  }

  const totalAssets = round(breakdown.cash + breakdown.investments + breakdown.real_estate + breakdown.vehicles);
  const totalLiabilities = round(
    breakdown.credit_cards + breakdown.mortgages + breakdown.loans + (breakdown.other_liabilities ?? 0),
  );
  const netWorth = computeNetWorth(totalAssets, totalLiabilities);

  // Today's point on the chart. Viewers can't write it, which is fine: the
  // next writer to look records it.
  await supabase.from("net_worth_snapshots").upsert(
    {
      organization_id: orgId,
      date: today,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      net_worth: netWorth,
      breakdown,
    },
    { onConflict: "organization_id,date" },
  );

  return {
    organizationId: orgId,
    date: today,
    totalAssets,
    totalLiabilities,
    netWorth,
    breakdown,
    items: items.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
  };
}

// Daily points cover this many days back; before that, month-ends.
const DAILY_DAYS = 183;

// The chart's dates: every month-end from the first entry's month, and
// every day of the last six months, through today.
export function historyDates(firstDate: string, today: string): string[] {
  const dates = new Set<string>();
  for (let end = addDays(nextMonthStart(firstDate), -1); end < today; end = addDays(nextMonthStart(addDays(end, 1)), -1)) {
    dates.add(end);
  }
  for (let d = addDays(today, -DAILY_DAYS); d <= today; d = addDays(d, 1)) {
    if (d >= firstDate) dates.add(d);
  }
  dates.add(today);
  return [...dates].sort();
}

function nextMonthStart(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

interface PropertyValue {
  estimated_value: number | string | null;
  purchase_price: number | string | null;
  purchase_date: string | null;
}

// Net worth over time, worked out from the ledger (get_net_worth_series)
// rather than from snapshots saved on visits. Properties count at today's
// estimated value from their purchase date on; there's no history of
// estimates. Investment accounts move only where statements are booked, so
// their daily points step at statement ends.
export async function fetchNetWorthHistory(
  orgId: string,
  today: string,
  supabaseClient?: Awaited<ReturnType<typeof createClient>>,
): Promise<{ date: string; net_worth: number; total_assets: number; total_liabilities: number }[]> {
  const supabase = supabaseClient ?? (await createClient());

  const [{ data: first }, { data: properties }] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("entry_date")
      .eq("organization_id", orgId)
      .eq("status", "posted")
      .order("entry_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("properties").select("estimated_value, purchase_price, purchase_date").eq("organization_id", orgId),
  ]);
  if (!first) return [];

  const { data, error } = await supabase.rpc("get_net_worth_series", {
    p_org_id: orgId,
    p_dates: historyDates((first as { entry_date: string }).entry_date, today),
  });
  if (error) throw new Error(`Failed to load net worth history: ${error.message}`);

  const props = (properties ?? []) as PropertyValue[];
  return ((data ?? []) as { as_of: string; total_assets: number | string; total_liabilities: number | string }[]).map(
    (row) => {
      const propertyValue = props
        .filter((p) => !p.purchase_date || p.purchase_date <= row.as_of)
        .reduce((sum, p) => sum + Number(p.estimated_value ?? p.purchase_price ?? 0), 0);
      const totalAssets = round(Number(row.total_assets) + propertyValue);
      const totalLiabilities = round(Number(row.total_liabilities));
      return {
        date: row.as_of,
        net_worth: computeNetWorth(totalAssets, totalLiabilities),
        total_assets: totalAssets,
        total_liabilities: totalLiabilities,
      };
    },
  );
}

type HistoryPoint = Awaited<ReturnType<typeof fetchNetWorthHistory>>[number];

// The history with today's point taken from the live figures. The stored row
// for today can't be trusted here: the page reads the history while it's
// saving today's snapshot, and viewers don't save one at all.
export function withTodaysPoint(history: HistoryPoint[], today: NetWorthSnapshotData): HistoryPoint[] {
  return [
    ...history.filter((point) => point.date !== today.date),
    {
      date: today.date,
      net_worth: today.netWorth,
      total_assets: today.totalAssets,
      total_liabilities: today.totalLiabilities,
    },
  ];
}

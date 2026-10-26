import { createClient } from "@/lib/supabase/server";
import { instanceTimezone } from "@/lib/org/book-clock";
import { localDate } from "@/lib/time/book-time";
import { exchangeRate } from "@/lib/plugins/server-loader";
import type { ExchangeRate } from "@/lib/plugins/types";

export interface BusinessEquityRollup {
  organizationId: string;
  organizationName: string;
  // In the business's own currency.
  currency: string;
  assets: number;
  liabilities: number;
  bookEquity: number;
  // Suspended by a Site Admin: listed, greyed out, and not counted. One
  // suspended before its books were closed isn't listed at all.
  suspended: boolean;
  // A suspended business with closed books: what was booked after the
  // close, which the closed figures don't cover.
  afterClose?: { closedThrough: string; entries: number; equityChange: number };
  // What it adds to the household, in the household's currency: bookEquity
  // itself, or converted at `quote`. Null when there's no quote to use, or
  // the business is suspended.
  counted: number | null;
  quote?: ExchangeRate;
}

export function computeBookEquity(assets: number, liabilities: number): number {
  return Math.round((assets - liabilities) * 100) / 100;
}

// Suspended before the books were closed (period lock date): the business
// was done with before its last close, so a household needn't see it.
export function suspendedBeforeClose(suspendedAt: string | null, closedThrough: string | null, timeZone: string): boolean {
  return !!suspendedAt && !!closedThrough && localDate(timeZone, new Date(suspendedAt)) < closedThrough;
}

// Businesses kept in `currency` (the household's) are added up as they
// are. One in another currency is added at a quote, when an exchange-rate
// plugin gives one, and otherwise listed but left out. A quote is only for
// showing: nothing converted is stored or booked.
export async function calculateUserBusinessEquity(
  userId: string,
  supabaseClient?: Awaited<ReturnType<typeof createClient>>,
  currency = "USD",
  rateFor: (from: string, to: string) => Promise<ExchangeRate | null> = exchangeRate,
): Promise<{
  businesses: BusinessEquityRollup[];
  totalBusinessEquity: number;
}> {
  const supabase = supabaseClient ?? (await createClient());

  // Find business organizations owned by this user
  const { data: members, error: memError } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(id, name, workspace_type, timezone, currency, status, suspended_at, period_lock_date)")
    .eq("user_id", userId)
    .eq("role", "owner");

  if (memError || !members) {
    return { businesses: [], totalBusinessEquity: 0 };
  }

  interface OrgMemberRecord {
    organization_id: string;
    role: string;
    organizations?: {
      id: string;
      name: string;
      workspace_type?: string;
      timezone?: string | null;
      currency?: string;
      status?: string;
      suspended_at?: string | null;
      period_lock_date?: string | null;
    } | null;
  }

  const businessOrgs: { id: string; name: string; timeZone: string; currency: string; suspended: boolean; closedThrough: string | null }[] = [];
  for (const m of members as unknown as OrgMemberRecord[]) {
    const o = m.organizations;
    if (o && (o.workspace_type === "business" || !o.workspace_type)) {
      const timeZone = o.timezone ?? instanceTimezone();
      const suspended = o.status === "suspended";
      if (suspended && suspendedBeforeClose(o.suspended_at ?? null, o.period_lock_date ?? null, timeZone)) continue;
      businessOrgs.push({
        id: o.id,
        name: o.name,
        // Each business's balances as of its own today.
        timeZone,
        currency: o.currency ?? "USD",
        suspended,
        closedThrough: o.period_lock_date ?? null,
      });
    }
  }

  const businesses: BusinessEquityRollup[] = await Promise.all(
    businessOrgs.map(async (org) => {
      const { assets, liabilities } = await balancesAsOf(supabase, org.id, localDate(org.timeZone));
      const bookEquity = computeBookEquity(assets, liabilities);
      const afterClose = org.suspended && org.closedThrough ? await bookedAfter(supabase, org.id, org.closedThrough, bookEquity) : undefined;
      const quote = org.suspended || org.currency === currency ? null : await rateFor(org.currency, currency);
      return {
        organizationId: org.id,
        organizationName: org.name,
        currency: org.currency,
        assets,
        liabilities,
        bookEquity,
        suspended: org.suspended,
        ...(afterClose ? { afterClose } : {}),
        counted: org.suspended ? null : org.currency === currency ? bookEquity : quote ? Math.round(bookEquity * quote.rate * 100) / 100 : null,
        ...(quote ? { quote } : {}),
      };
    }),
  );

  const totalBusinessEquity = Math.round(
    businesses.reduce((sum, b) => sum + (b.counted ?? 0), 0) * 100,
  ) / 100;

  return { businesses, totalBusinessEquity };
}

type Client = Awaited<ReturnType<typeof createClient>>;

// Computed in the database (get_balance_sheet), so there's no row limit.
async function balancesAsOf(supabase: Client, orgId: string, asOf: string): Promise<{ assets: number; liabilities: number }> {
  const { data: rows } = await supabase.rpc("get_balance_sheet", { p_org_id: orgId, p_as_of_date: asOf });
  let assets = 0;
  let liabilities = 0;
  for (const row of (rows ?? []) as { account_id: string | null; type: string; balance: number | string }[]) {
    if (!row.account_id) continue;
    if (row.type === "asset") assets += Number(row.balance);
    else if (row.type === "liability") liabilities += Number(row.balance);
  }
  return { assets: Math.round(assets * 100) / 100, liabilities: Math.round(liabilities * 100) / 100 };
}

async function bookedAfter(supabase: Client, orgId: string, closedThrough: string, equityNow: number) {
  const [{ count }, atClose] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "posted")
      .gt("entry_date", closedThrough),
    balancesAsOf(supabase, orgId, closedThrough),
  ]);
  return {
    closedThrough,
    entries: count ?? 0,
    equityChange: Math.round((equityNow - computeBookEquity(atClose.assets, atClose.liabilities)) * 100) / 100,
  };
}

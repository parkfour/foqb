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
  // What it adds to the household, in the household's currency: bookEquity
  // itself, or converted at `quote`. Null when there's no quote to use.
  counted: number | null;
  quote?: ExchangeRate;
}

export function computeBookEquity(assets: number, liabilities: number): number {
  return Math.round((assets - liabilities) * 100) / 100;
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
    .select("organization_id, role, organizations(id, name, workspace_type, timezone, currency)")
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
    } | null;
  }

  const businessOrgs: { id: string; name: string; timeZone: string; currency: string }[] = [];
  for (const m of members as unknown as OrgMemberRecord[]) {
    if (
      m.organizations &&
      (m.organizations.workspace_type === "business" || !m.organizations.workspace_type)
    ) {
      businessOrgs.push({
        id: m.organizations.id,
        name: m.organizations.name,
        // Each business's balances as of its own today.
        timeZone: m.organizations.timezone ?? instanceTimezone(),
        currency: m.organizations.currency ?? "USD",
      });
    }
  }

  // Computed in the database (get_balance_sheet), so there's no row limit.
  const businesses: BusinessEquityRollup[] = await Promise.all(
    businessOrgs.map(async (org) => {
      const { data: rows } = await supabase.rpc("get_balance_sheet", { p_org_id: org.id, p_as_of_date: localDate(org.timeZone) });
      let assets = 0;
      let liabilities = 0;
      for (const row of (rows ?? []) as { account_id: string | null; type: string; balance: number | string }[]) {
        if (!row.account_id) continue;
        if (row.type === "asset") assets += Number(row.balance);
        else if (row.type === "liability") liabilities += Number(row.balance);
      }
      assets = Math.round(assets * 100) / 100;
      liabilities = Math.round(liabilities * 100) / 100;
      const bookEquity = computeBookEquity(assets, liabilities);
      const quote = org.currency === currency ? null : await rateFor(org.currency, currency);
      return {
        organizationId: org.id,
        organizationName: org.name,
        currency: org.currency,
        assets,
        liabilities,
        bookEquity,
        counted: org.currency === currency ? bookEquity : quote ? Math.round(bookEquity * quote.rate * 100) / 100 : null,
        ...(quote ? { quote } : {}),
      };
    }),
  );

  const totalBusinessEquity = Math.round(
    businesses.reduce((sum, b) => sum + (b.counted ?? 0), 0) * 100,
  ) / 100;

  return { businesses, totalBusinessEquity };
}

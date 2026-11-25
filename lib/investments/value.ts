import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllRows } from "@/lib/supabase/read-all";
import { computeHoldings, type Holding, type Trade } from "./holdings";

export interface ValuedHolding extends Holding {
  symbol: string;
  name: string | null;
  price: number | null;
  priceDate: string | null;
  // Quantity at the latest price; cost when there's no price yet.
  value: number;
}

export interface InvestmentData {
  trades: Trade[];
  securities: { id: string; symbol: string; name: string | null }[];
  prices: { security_id: string; price_date: string; price: number }[];
}

// Trades and prices on or before a date, every row (a long price history
// runs past the API's 1,000-row page).
export async function fetchInvestmentData(supabase: SupabaseClient, orgId: string, asOf: string): Promise<InvestmentData> {
  const [trades, { data: securities }, prices] = await Promise.all([
    readAllRows<Trade>((from, to) =>
      supabase
        .from("investment_trades")
        .select("account_id, security_id, trade_date, kind, quantity, price, fees")
        .eq("organization_id", orgId)
        .lte("trade_date", asOf)
        .order("trade_date")
        .order("id")
        .range(from, to),
    ),
    supabase.from("securities").select("id, symbol, name").eq("organization_id", orgId),
    readAllRows<InvestmentData["prices"][number]>((from, to) =>
      supabase
        .from("security_prices")
        .select("security_id, price_date, price")
        .eq("organization_id", orgId)
        .lte("price_date", asOf)
        .order("price_date", { ascending: false })
        .order("security_id")
        .range(from, to),
    ),
  ]);
  return { trades, securities: (securities ?? []) as InvestmentData["securities"], prices };
}

// Each account's holdings as of a date, valued at the latest price on or
// before it.
export function valueHoldings(data: InvestmentData, asOf: string): ValuedHolding[] {
  const bySecurity = new Map(data.securities.map((s) => [s.id, s]));
  const latest = new Map<string, { price: number; price_date: string }>();
  for (const p of data.prices) {
    const seen = latest.get(p.security_id);
    if (p.price_date <= asOf && (!seen || p.price_date > seen.price_date)) {
      latest.set(p.security_id, { price: Number(p.price), price_date: p.price_date });
    }
  }
  return computeHoldings(data.trades.filter((t) => t.trade_date <= asOf))
    .filter((h) => h.quantity !== 0 || h.cost !== 0)
    .map((h) => {
      const quote = latest.get(h.security_id);
      return {
        ...h,
        symbol: bySecurity.get(h.security_id)?.symbol ?? "?",
        name: bySecurity.get(h.security_id)?.name ?? null,
        price: quote?.price ?? null,
        priceDate: quote?.price_date ?? null,
        value: quote ? Math.round(h.quantity * quote.price * 100) / 100 : h.cost,
      };
    });
}

export async function fetchHoldings(supabase: SupabaseClient, orgId: string, asOf: string): Promise<ValuedHolding[]> {
  return valueHoldings(await fetchInvestmentData(supabase, orgId, asOf), asOf);
}

// Per account: what its holdings are worth over what they cost.
export function unrealizedByAccount(holdings: ValuedHolding[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of holdings) out.set(h.account_id, Math.round(((out.get(h.account_id) ?? 0) + h.value - h.cost) * 100) / 100);
  return out;
}

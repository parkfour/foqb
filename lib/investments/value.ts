import type { SupabaseClient } from "@supabase/supabase-js";
import { computeHoldings, type Holding, type Trade } from "./holdings";

export interface ValuedHolding extends Holding {
  symbol: string;
  name: string | null;
  price: number | null;
  priceDate: string | null;
  // Quantity at the latest price; cost when there's no price yet.
  value: number;
}

// Each account's holdings as of a date, valued at the latest price on or
// before it.
export async function fetchHoldings(supabase: SupabaseClient, orgId: string, asOf: string): Promise<ValuedHolding[]> {
  const [{ data: trades, error }, { data: securities }, { data: prices }] = await Promise.all([
    supabase
      .from("investment_trades")
      .select("account_id, security_id, trade_date, kind, quantity, price, fees")
      .eq("organization_id", orgId)
      .lte("trade_date", asOf)
      .order("trade_date"),
    supabase.from("securities").select("id, symbol, name").eq("organization_id", orgId),
    supabase
      .from("security_prices")
      .select("security_id, price_date, price")
      .eq("organization_id", orgId)
      .lte("price_date", asOf)
      .order("price_date", { ascending: false }),
  ]);
  if (error) throw error;
  const bySecurity = new Map(((securities ?? []) as { id: string; symbol: string; name: string | null }[]).map((s) => [s.id, s]));
  const latest = new Map<string, { price: number; price_date: string }>();
  for (const p of (prices ?? []) as { security_id: string; price_date: string; price: number }[]) {
    if (!latest.has(p.security_id)) latest.set(p.security_id, { price: Number(p.price), price_date: p.price_date });
  }
  return computeHoldings((trades ?? []) as Trade[])
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

// Per account: what its holdings are worth over what they cost.
export function unrealizedByAccount(holdings: ValuedHolding[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of holdings) out.set(h.account_id, Math.round(((out.get(h.account_id) ?? 0) + h.value - h.cost) * 100) / 100);
  return out;
}

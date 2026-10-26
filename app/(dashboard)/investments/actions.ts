"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { canWrite, getCurrentOrgId, getCurrentUserRole } from "@/lib/org/current";
import { getOrgEnabledPluginIds } from "@/lib/plugins/settings";
import { securityPrice } from "@/lib/plugins/server-loader";
import { fetchHoldings } from "@/lib/investments/value";
import { saleOf } from "@/lib/investments/holdings";

type State = { error: string | null };

const symbolOf = (raw: FormDataEntryValue | null) => String(raw ?? "").trim().toUpperCase();

// The book's security for a symbol, added the first time it's used.
async function securityId(supabase: SupabaseClient, orgId: string, symbol: string, name: string | null): Promise<string | { error: string }> {
  const { data: found } = await supabase.from("securities").select("id").eq("organization_id", orgId).eq("symbol", symbol).maybeSingle();
  if (found) return (found as { id: string }).id;
  const id = crypto.randomUUID();
  const { error } = await supabase.from("securities").insert({ id, organization_id: orgId, symbol, name });
  return error ? { error: error.message } : id;
}

// Books the trade too when a cash account is given: a buy moves cash into
// the investment account at cost; a sell moves the average cost out, the
// proceeds into cash and the difference to the gain or loss account.
export async function addTrade(_prev: State, formData: FormData): Promise<State> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { error: "No book selected" };
  const accountId = formData.get("accountId") as string;
  const symbol = symbolOf(formData.get("symbol"));
  const tradeDate = formData.get("tradeDate") as string;
  const kind = formData.get("kind") === "sell" ? "sell" : "buy";
  const quantity = Number(formData.get("quantity"));
  const price = Number(formData.get("price"));
  const fees = Number(formData.get("fees") || 0);
  const cashAccountId = (formData.get("cashAccountId") as string) || null;
  const gainAccountId = (formData.get("gainAccountId") as string) || null;
  if (!accountId || !tradeDate || !/^[A-Z0-9.^-]{1,20}$/.test(symbol)) return { error: "Account, date and a symbol are required" };
  if (!(quantity > 0) || !(price >= 0) || !(fees >= 0)) return { error: "Enter a quantity, price and fees" };
  if (kind === "sell" && cashAccountId && !gainAccountId) return { error: "Choose where a sale's gain or loss goes" };

  const supabase = await createClient();
  const security = await securityId(supabase, orgId, symbol, ((formData.get("name") as string) || "").trim() || null);
  if (typeof security !== "string") return security;

  let journalEntryId: string | null = null;
  if (cashAccountId) {
    let lines: { account_id: string; debit: number; credit: number }[];
    if (kind === "buy") {
      const cost = Math.round((quantity * price + fees) * 100) / 100;
      lines = [
        { account_id: accountId, debit: cost, credit: 0 },
        { account_id: cashAccountId, debit: 0, credit: cost },
      ];
    } else {
      const held = (await fetchHoldings(supabase, orgId, tradeDate)).find((h) => h.account_id === accountId && h.security_id === security);
      const sale = saleOf(held ?? { quantity: 0, cost: 0 }, quantity, price, fees);
      lines = [
        { account_id: cashAccountId, debit: sale.proceeds, credit: 0 },
        { account_id: accountId, debit: 0, credit: sale.cost },
        sale.gain >= 0
          ? { account_id: gainAccountId as string, debit: 0, credit: sale.gain }
          : { account_id: gainAccountId as string, debit: -sale.gain, credit: 0 },
      ].filter((l) => l.debit > 0 || l.credit > 0);
    }
    const { data, error } = await supabase.rpc("post_journal_entry", {
      p_org_id: orgId,
      p_entry_date: tradeDate,
      p_memo: `${kind === "buy" ? "Bought" : "Sold"} ${quantity} ${symbol} at ${price}`,
      p_lines: lines,
    });
    if (error) return { error: error.message };
    journalEntryId = data as string;
  }

  const { error } = await supabase.from("investment_trades").insert({
    organization_id: orgId,
    account_id: accountId,
    security_id: security,
    trade_date: tradeDate,
    kind,
    quantity,
    price,
    fees,
    journal_entry_id: journalEntryId,
  });
  if (error) return { error: error.message };
  revalidatePath("/investments");
  return { error: null };
}

export async function deleteTrade(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;
  const supabase = await createClient();
  // A booked trade stays: void its entry from the journal first.
  await supabase.from("investment_trades").delete().eq("id", id).is("journal_entry_id", null);
  revalidatePath("/investments");
}

export async function setPrice(_prev: State, formData: FormData): Promise<State> {
  const orgId = await getCurrentOrgId();
  const symbol = symbolOf(formData.get("symbol"));
  const priceDate = formData.get("priceDate") as string;
  const price = Number(formData.get("price"));
  if (!orgId || !symbol || !priceDate || !(price >= 0)) return { error: "Symbol, date and price are required" };
  const supabase = await createClient();
  const security = await securityId(supabase, orgId, symbol, null);
  if (typeof security !== "string") return security;
  const { error } = await supabase
    .from("security_prices")
    .upsert({ organization_id: orgId, security_id: security, price_date: priceDate, price, source: "Entered" }, { onConflict: "security_id,price_date" });
  if (error) return { error: error.message };
  revalidatePath("/investments");
  return { error: null };
}

// Asks the book's price plugins for each security's latest close.
export async function updatePrices(): Promise<State> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { error: "No book selected" };
  // Writers only: it asks an outside service and saves what it says.
  if (!canWrite(await getCurrentUserRole(orgId))) return { error: "You can't change prices in this book" };
  const supabase = await createClient();
  const [{ data: securities }, enabled] = await Promise.all([
    supabase.from("securities").select("id, symbol").eq("organization_id", orgId),
    getOrgEnabledPluginIds(supabase, orgId),
  ]);
  const missed: string[] = [];
  for (const s of (securities ?? []) as { id: string; symbol: string }[]) {
    const quote = await securityPrice(s.symbol, enabled);
    if (!quote) {
      missed.push(s.symbol);
      continue;
    }
    const { error } = await supabase
      .from("security_prices")
      .upsert(
        { organization_id: orgId, security_id: s.id, price_date: quote.asOf, price: quote.price, source: quote.source },
        { onConflict: "security_id,price_date" },
      );
    if (error) return { error: `Couldn't save the price for ${s.symbol}: ${error.message}` };
  }
  revalidatePath("/investments");
  if ((securities ?? []).length === 0) return { error: "No securities yet" };
  return missed.length
    ? { error: `No price for ${missed.join(", ")}. Turn on the Security prices plugin, or enter prices yourself.` }
    : { error: null };
}

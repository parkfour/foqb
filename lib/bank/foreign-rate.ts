import type { SupabaseClient } from "@supabase/supabase-js";
import { exchangeRate } from "@/lib/plugins/server-loader";

// For rows coming into an account kept in another currency than the book's
// (migration 100): the rate to book them at, in the book's currency per
// unit of the account's, from the exchange-rates plugin's quote. Null for
// an account in the book's own currency, or when no plugin has a quote
// (the row then waits on the feed for a rate to be set by hand).
export async function importExchangeRate(supabase: SupabaseClient, accountId: string): Promise<number | null> {
  const { data } = await supabase
    .from("accounts")
    .select("currency, organizations(currency)")
    .eq("id", accountId)
    .maybeSingle();
  const account = data as { currency: string | null; organizations: { currency: string } | null } | null;
  const book = account?.organizations?.currency;
  if (!account?.currency || !book || account.currency === book) return null;
  const quote = await exchangeRate(account.currency, book);
  return quote?.rate ?? null;
}

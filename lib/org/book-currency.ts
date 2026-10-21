import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// The book's currency, once per request per organization.
export const getBookCurrency = cache(async (orgId: string | null): Promise<string> => {
  if (!orgId) return "USD";
  const supabase = await createClient();
  const { data } = await supabase.from("organizations").select("currency").eq("id", orgId).maybeSingle();
  return (data as { currency: string } | null)?.currency ?? "USD";
});

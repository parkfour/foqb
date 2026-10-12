import type { SupabaseClient } from "@supabase/supabase-js";
import { getSiteSettings } from "@/lib/site/settings";

export const BANK_LINKING_OFF_SITE = "Connecting banks is turned off on this instance.";
export const BANK_LINKING_OFF_ORG =
  "Connecting banks is turned off for this organization. An owner can turn it on in Settings.";

// Why this org can't connect or reconnect a bank right now, or null if it
// can. Both the Site Admin switch and the org's own switch must be on;
// backed by a database policy on enrollments (20260101000044).
export async function bankLinkingBlockedReason(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const [site, { data: org }] = await Promise.all([
    getSiteSettings(supabase),
    supabase.from("organizations").select("bank_linking_enabled").eq("id", organizationId).maybeSingle(),
  ]);

  if (!site.bankLinkingEnabled) return BANK_LINKING_OFF_SITE;
  if (!(org as { bank_linking_enabled: boolean } | null)?.bank_linking_enabled) return BANK_LINKING_OFF_ORG;
  return null;
}

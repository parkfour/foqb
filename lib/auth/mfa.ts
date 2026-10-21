import type { SupabaseClient } from "@supabase/supabase-js";

// Bank connections (Plaid Link) require two-factor: the session must have
// completed a second factor (AAL2). A user with no factor enrolled can never
// reach AAL2, so this also means "has two-factor set up". Backed by a
// database policy on enrollments (20260101000042) for new connections.
export const MFA_REQUIRED_FOR_BANKS =
  "Set up two-factor authentication (Settings → Two-Factor Authentication) before connecting or reconnecting a bank.";

export async function hasPassedMfa(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal2";
}

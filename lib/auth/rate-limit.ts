import { createAdminClient } from "@/lib/supabase/admin";

// Each scope gets its own key namespace so, e.g., a signup burst from one IP
// can't also lock out that IP's login attempts.
export async function checkRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: `${scope}:${identifier}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  // Fail open — a rate-limiter outage shouldn't take down login/signup.
  if (error) {
    console.error("Rate limit check failed", error);
    return true;
  }

  return data as boolean;
}

// Forgets the attempts counted against one identifier, e.g. an email after a
// successful sign-in, so its owner's own logins never add up to a lockout.
export async function clearRateLimit(scope: string, identifier: string): Promise<void> {
  const { error } = await createAdminClient().from("rate_limit_hits").delete().eq("key", `${scope}:${identifier}`);
  if (error) console.error("Rate limit reset failed", error);
}

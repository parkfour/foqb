import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for trusted, server-only background work (e.g. webhook
// handlers). Bypasses RLS — never import this into client-side code.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

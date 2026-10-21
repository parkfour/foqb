import { createAdminClient } from "@/lib/supabase/admin";

// Windows are at most an hour wide (see lib/auth/rate-limit.ts's callers),
// so anything older than a day is long past mattering for any limit check —
// delete it before the table grows unbounded.
const RETENTION_HOURS = 24;

export interface CleanupRateLimitsResult {
  deleted: number;
}

export async function cleanupRateLimits(): Promise<CleanupRateLimitsResult> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("rate_limit_hits")
    .delete()
    .lt("window_start", cutoff)
    .select("key");

  if (error) {
    throw new Error(error.message);
  }

  return { deleted: data?.length ?? 0 };
}

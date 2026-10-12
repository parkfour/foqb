import { createAdminClient } from "@/lib/supabase/admin";
import { cleanupUnclaimedMembers } from "./cleanup-unclaimed-members";
import { cleanupRateLimits } from "./cleanup-rate-limits";

// Runs maintenance jobs inline off real traffic instead of a scheduled
// job — Vercel's Hobby plan caps cron jobs at one per account, and two
// projects each needing two jobs blew past that. Neither job is
// time-critical (7-day / 24h retention windows), so "close enough to on
// schedule" is fine. Each job claims its own run atomically
// (claim_cron_run), so a burst of concurrent requests can't all claim —
// and re-run — the same job; when nothing is due this is one cheap row
// check per job, not the actual cleanup work.
const JOBS: { name: string; minIntervalSeconds: number; run: () => Promise<unknown> }[] = [
  { name: "cleanup-unclaimed-members", minIntervalSeconds: 24 * 60 * 60, run: cleanupUnclaimedMembers },
  { name: "cleanup-rate-limits", minIntervalSeconds: 60 * 60, run: cleanupRateLimits },
];

export async function maybeRunDueCronJobs(): Promise<void> {
  const admin = createAdminClient();

  for (const job of JOBS) {
    try {
      const { data: claimed, error } = await admin.rpc("claim_cron_run", {
        p_job_name: job.name,
        p_min_interval_seconds: job.minIntervalSeconds,
      });

      if (error) {
        console.error(`Failed to claim cron run for ${job.name}`, error);
        continue;
      }

      if (claimed) {
        await job.run();
      }
    } catch (error) {
      console.error(`Piggyback cron job ${job.name} failed`, error);
    }
  }
}

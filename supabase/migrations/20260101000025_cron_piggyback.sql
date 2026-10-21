-- ============================================================================
-- Replaces Vercel Cron for the two maintenance jobs (cleanup-unclaimed-
-- members, cleanup-rate-limits): Vercel's Hobby plan caps cron jobs at one
-- per account, and two projects each needing two jobs blew past that.
-- Neither job is time-critical (7-day and 24h retention windows), so both
-- can instead piggyback on real request traffic — see
-- lib/cron/piggyback.ts, invoked from middleware via next/server's after().
-- ============================================================================

create table cron_runs (
  job_name     text primary key,
  last_run_at  timestamptz not null default now()
);

alter table cron_runs enable row level security;

-- Atomic claim: succeeds (returns true) only if no run is on record yet, or
-- the last one is older than p_min_interval_seconds — the same
-- upsert-and-check-if-a-row-came-back pattern as check_rate_limit, so a
-- burst of concurrent requests can't all claim (and re-run) the same job.
create function claim_cron_run(p_job_name text, p_min_interval_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  insert into cron_runs (job_name, last_run_at)
  values (p_job_name, now())
  on conflict (job_name) do update
    set last_run_at = now()
    where cron_runs.last_run_at < now() - make_interval(secs => p_min_interval_seconds)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

grant execute on function claim_cron_run(text, int) to service_role;

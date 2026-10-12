-- ============================================================================
-- Rate limiting for unauthenticated auth endpoints (login, signup, forgot
-- password, MFA challenge) — none of these had any brute-force protection.
-- Serverless functions have no reliable shared in-memory state, so this is
-- a single shared table plus an atomic upsert-increment RPC. Called only
-- via the service-role admin client (see lib/auth/rate-limit.ts) — no RLS
-- policies are defined, so anon/authenticated have no direct access.
-- ============================================================================

create table rate_limit_hits (
  key           text not null,
  window_start  timestamptz not null,
  count         int not null default 1,
  primary key (key, window_start)
);

alter table rate_limit_hits enable row level security;

create index rate_limit_hits_window_start_idx on rate_limit_hits (window_start);

-- Atomically increments the hit count for (key, current window) and
-- returns whether the caller is still within p_limit. window_start is
-- floored to p_window_seconds so every hit in the same window shares one
-- row — bounds row growth and makes the check a single upsert-and-read
-- instead of a separate count query, which would race under concurrent
-- requests.
create function check_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into rate_limit_hits (key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = rate_limit_hits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

grant execute on function check_rate_limit(text, int, int) to service_role;

-- ============================================================================
-- Replace the email-based invite flow (organization_invites,
-- accept/decline-by-email) with owner-created accounts. The old flow
-- fundamentally depended on the invitee learning about the invite via
-- email, which this app never sends (no SMTP, by design) — there was no
-- other way for them to discover a pending invite existed at all.
--
-- The new flow: an owner creates the member's account directly (via the
-- Supabase Auth admin API, app-side) with a generated password shown once,
-- and distributes the credentials themselves. Unclaimed accounts (never
-- logged in) expire automatically — see pending_member_accounts below and
-- the daily cleanup cron.
-- ============================================================================

create or replace function is_org_owner(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from organization_members
      where organization_id = p_org_id
        and user_id = auth.uid()
        and role = 'owner'
  );
$$;

-- The old accept-by-email RPC and its table are no longer reachable from
-- the app; drop them rather than leave dead, RLS-governed surface area.
drop function if exists accept_organization_invite(uuid);
drop table if exists organization_invites;

-- Tracks owner-created accounts until either the invitee logs in (the row
-- is removed) or the cleanup cron deletes the unclaimed account. No RLS
-- policies are defined — every consumer (the create-account action, the
-- cleanup cron) goes through the service-role admin client, which bypasses
-- RLS entirely, so this table is intentionally unreachable from anon/
-- authenticated roles.
create table pending_member_accounts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  unique (user_id)
);

alter table pending_member_accounts enable row level security;

-- get_org_members already joins auth.users for email; also surface whether
-- the member has ever logged in, so the Settings page can show a "pending"
-- badge without a separate admin API round trip per member. Adding a
-- column changes the function's return type, which `create or replace`
-- can't do — drop and recreate.
drop function if exists get_org_members(uuid);

create function get_org_members(p_org_id uuid)
returns table (id uuid, user_id uuid, email text, role member_role, has_logged_in boolean)
language sql
security definer
stable
set search_path = public
as $$
  select om.id, om.user_id, au.email::text, om.role, (au.last_sign_in_at is not null) as has_logged_in
    from organization_members om
    join auth.users au on au.id = om.user_id
    where om.organization_id = p_org_id
      and om.organization_id in (select get_user_org_ids());
$$;

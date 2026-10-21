-- ============================================================================
-- A user with a verified TOTP factor must be at AAL2 before the database
-- trusts their session. The app's middleware only gated page routes, and
-- the anon key + an AAL1 session (password only) could read everything RLS
-- allowed straight from PostgREST — so the second factor protected the UI
-- and nothing else.
--
-- Enforced at two choke points:
--   1. The membership helpers every RLS policy and SECURITY DEFINER RPC
--      already routes through (get_user_org_ids, is_org_writer,
--      is_org_owner, is_site_admin) now return "no access" at AAL1.
--   2. A RESTRICTIVE policy on every RLS-enabled public table catches the
--      policies that check auth.uid() directly instead.
-- ponytail: (2) is applied to the tables that exist now; a table added by
-- a later migration needs the same policy added alongside its own.
-- ============================================================================

create or replace function mfa_satisfied()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors
         where user_id = auth.uid() and status = 'verified'
      );
$$;

create or replace function get_user_org_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select om.organization_id
    from organization_members om
    join organizations o on o.id = om.organization_id
    where om.user_id = auth.uid()
      and (o.status = 'active' or om.role = 'owner')
      and mfa_satisfied();
$$;

create or replace function is_org_writer(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select mfa_satisfied() and exists (
    select 1
      from organization_members om
      join organizations o on o.id = om.organization_id
      where om.organization_id = p_org_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'accountant')
        and o.status = 'active'
  );
$$;

create or replace function is_org_owner(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select mfa_satisfied() and exists (
    select 1
      from organization_members
      where organization_id = p_org_id
        and user_id = auth.uid()
        and role = 'owner'
  );
$$;

create or replace function is_site_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select mfa_satisfied() and exists (select 1 from site_admins where user_id = auth.uid());
$$;

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format(
      'create policy "Require MFA when enrolled" on %I as restrictive to authenticated using (mfa_satisfied()) with check (mfa_satisfied())',
      t.relname
    );
  end loop;
end
$$;

-- ============================================================================
-- Organization invites: let an owner/accountant add another user to their
-- org by email, without requiring that user to already exist.
--
-- Also closes a real gap in the existing bootstrap self-insert policy: it
-- only checked `user_id = auth.uid()`, with no tie to the organization_id at
-- all, so any authenticated user could grant themselves membership (any
-- role, including owner) in ANY organization just by knowing its id. Fixed
-- by restricting the self-insert path to orgs that have no members yet
-- (the actual bootstrap case), and routing invite acceptance through a
-- security-definer RPC that verifies the invite's email against the caller's
-- verified JWT email instead.
-- ============================================================================

create or replace function org_has_no_members(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (
    select 1 from organization_members where organization_id = p_org_id
  );
$$;

drop policy "Members can manage organization members" on organization_members;

create policy "Members can manage organization members"
  on organization_members for insert
  with check (
    is_org_writer(organization_id)
    or (user_id = auth.uid() and org_has_no_members(organization_id))
  );

-- ----------------------------------------------------------------------------
-- organization_invites
-- ----------------------------------------------------------------------------

create table organization_invites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  email            text not null,
  role             member_role not null default 'accountant',
  invited_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  unique (organization_id, email)
);

create index idx_organization_invites_email on organization_invites (email);

alter table organization_invites enable row level security;

create policy "Writers can view their org's invites"
  on organization_invites for select
  using (is_org_writer(organization_id));

create policy "Invitees can view invites addressed to them"
  on organization_invites for select
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "Writers can create invites"
  on organization_invites for insert
  with check (is_org_writer(organization_id));

create policy "Writers can delete invites"
  on organization_invites for delete
  using (is_org_writer(organization_id));

create policy "Invitees can decline invites addressed to them"
  on organization_invites for delete
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Accepting an invite needs to bypass the normal organization_members insert
-- policy (the invitee isn't a writer and the org already has members), so
-- it's a security-definer RPC that checks the invite's email against the
-- caller's own verified JWT email rather than relying on RLS.
create or replace function accept_organization_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role member_role;
  v_email text;
begin
  select organization_id, role, email into v_org_id, v_role, v_email
    from organization_invites
    where id = p_invite_id;

  if v_org_id is null then
    raise exception 'Invite not found';
  end if;

  if lower(v_email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite is not addressed to your account';
  end if;

  insert into organization_members (organization_id, user_id, role)
    values (v_org_id, auth.uid(), v_role)
    on conflict (organization_id, user_id) do nothing;

  delete from organization_invites where id = p_invite_id;
end;
$$;

grant execute on function accept_organization_invite(uuid) to authenticated;

-- organization_members has no email column (it's not exposed to PostgREST
-- via a join into the auth schema), so the Settings page needs an RPC to
-- list a member's email alongside their role.
create or replace function get_org_members(p_org_id uuid)
returns table (id uuid, user_id uuid, email text, role member_role)
language sql
security definer
stable
set search_path = public
as $$
  select om.id, om.user_id, au.email::text, om.role
    from organization_members om
    join auth.users au on au.id = om.user_id
    where om.organization_id = p_org_id
      and om.organization_id in (select get_user_org_ids());
$$;

grant execute on function get_org_members(uuid) to authenticated;

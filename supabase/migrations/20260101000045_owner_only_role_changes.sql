-- ============================================================================
-- Only owners can change roles or add members.
--
-- Until now any writer (owner or accountant) could: change roles through
-- update_org_member_role_guarded; update organization_members directly
-- through the database API; or insert a membership row for any existing
-- user, in any role. So an accountant could make themselves, or anyone
-- else, an owner. The owner-removal guard only protects existing owners
-- from being demoted or removed, not anyone from being promoted.
--
-- Unchanged: the first membership of a brand-new organization (its creator
-- becoming owner), and server-side code using the service role (which
-- bypasses RLS: owner-created member accounts, site-admin deletion).
-- ============================================================================

create or replace function update_org_member_role_guarded(p_member_id uuid, p_role member_role, p_secret text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id from organization_members where id = p_member_id;
  if v_org_id is null then
    raise exception 'Member not found';
  end if;

  if not is_org_owner(v_org_id) then
    raise exception 'Only an owner can change member roles';
  end if;

  perform set_config('app.owner_removal_secret', coalesce(p_secret, ''), true);
  update organization_members set role = p_role where id = p_member_id;
end;
$$;

drop policy "Writers can update organization members" on organization_members;
create policy "Owners can update organization members"
  on organization_members for update
  using (is_org_owner(organization_id))
  with check (is_org_owner(organization_id));

drop policy "Members can manage organization members" on organization_members;
create policy "Owners can add members, or the first owner can join"
  on organization_members for insert
  with check (
    is_org_owner(organization_id)
    or (user_id = auth.uid() and org_has_no_members(organization_id))
  );

-- ============================================================================
-- Completes 20260101000045: removing members is owner-only too. Until now
-- any writer could remove other members through remove_org_member_guarded
-- or by deleting organization_members rows directly; an accountant could
-- remove other accountants, viewers, and owners while two or more remained.
--
-- Unchanged: deleting a whole organization (Site Admin, security definer)
-- and server-side code using the service role.
-- ============================================================================

create or replace function remove_org_member_guarded(p_member_id uuid, p_secret text default null)
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
    raise exception 'Only an owner can remove members';
  end if;

  perform set_config('app.owner_removal_secret', coalesce(p_secret, ''), true);
  delete from organization_members where id = p_member_id;
end;
$$;

drop policy "Writers can remove organization members" on organization_members;
create policy "Owners can remove organization members"
  on organization_members for delete
  using (is_org_owner(organization_id));

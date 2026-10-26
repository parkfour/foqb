-- ============================================================================
-- When an organization was suspended. A household's net worth uses it with
-- the business's period lock date: suspended before the books were closed,
-- the business isn't listed at all; after, it's listed (greyed, not counted)
-- with what was booked after the close. The suspend log (site_admin_actions)
-- is Site Admin only, so the date is kept on the organization itself.
-- ============================================================================

alter table organizations add column suspended_at timestamptz;

update organizations o
set suspended_at = coalesce(
  (select max(a.created_at) from site_admin_actions a where a.organization_id = o.id and a.action = 'suspend'),
  now()
)
where o.status = 'suspended';

create or replace function set_organization_status(p_org_id uuid, p_status varchar)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_site_admin() then
    raise exception 'Only a Site Admin can change an organization''s status';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Invalid status: %', p_status;
  end if;

  insert into site_admin_actions (site_admin_id, action, organization_id, organization_name)
  select auth.uid(), case when p_status = 'suspended' then 'suspend' else 'unsuspend' end, id, name
  from organizations where id = p_org_id;

  -- Suspending again keeps the first date.
  update organizations
  set status = p_status,
      suspended_at = case when p_status = 'suspended' then coalesce(suspended_at, now()) end
  where id = p_org_id;
end;
$$;

-- As in 054 (book timezones), with suspended_at guarded like status.
create or replace function guard_org_protected_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.owner_removal_secret_hash is distinct from old.owner_removal_secret_hash
     and current_setting('app.setting_owner_removal_secret', true) is distinct from 'on' then
    raise exception 'The owner-removal secret can only be set from Settings, by an owner';
  end if;

  if (new.status is distinct from old.status or new.suspended_at is distinct from old.suspended_at)
     and not is_site_admin() then
    raise exception 'Only a Site Admin can suspend or unsuspend an organization';
  end if;

  if new.timezone is distinct from old.timezone
     and current_setting('app.setting_timezone', true) is distinct from 'on' then
    raise exception 'The timezone can only be changed from Settings, by an owner';
  end if;

  return new;
end;
$$;

drop trigger trg_guard_org_protected_columns on organizations;
create trigger trg_guard_org_protected_columns
  before update of owner_removal_secret_hash, status, timezone, suspended_at on organizations
  for each row execute function guard_org_protected_columns();

-- ============================================================================
-- Two switches for connecting banks (Plaid Link): one for the whole instance
-- (Site Admin console) and one per organization (its owners, in Settings).
-- Both must be on to connect a bank or reconnect one.
--
-- The API routes check first and refuse before any Plaid Item is created;
-- the restrictive policy below is the database backstop for new
-- connections. Existing connections keep syncing, and can still be
-- disconnected, whichever way the switches are set.
-- ============================================================================

alter table site_settings add column bank_linking_enabled boolean not null default true;
alter table organizations add column bank_linking_enabled boolean not null default true;

alter table site_admin_actions drop constraint site_admin_actions_action_check;
alter table site_admin_actions add constraint site_admin_actions_action_check
  check (action in (
    'suspend', 'unsuspend', 'delete', 'promote', 'demote',
    'signups_on', 'signups_off', 'banks_on', 'banks_off'
  ));

create or replace function log_site_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.signups_enabled is distinct from old.signups_enabled then
    insert into site_admin_actions (site_admin_id, action)
    values (auth.uid(), case when new.signups_enabled then 'signups_on' else 'signups_off' end);
  end if;
  if new.bank_linking_enabled is distinct from old.bank_linking_enabled then
    insert into site_admin_actions (site_admin_id, action)
    values (auth.uid(), case when new.bank_linking_enabled then 'banks_on' else 'banks_off' end);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Writers (owners and accountants) can update organizations; only an owner
-- may flip this one column. Server-side code without a user (auth.uid() is
-- null) is not restricted.
create or replace function guard_org_bank_linking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bank_linking_enabled is distinct from old.bank_linking_enabled
     and auth.uid() is not null
     and not is_org_owner(new.id) then
    raise exception 'Only an owner can change whether this organization can connect banks';
  end if;
  return new;
end;
$$;

create trigger trg_guard_org_bank_linking
  before update of bank_linking_enabled on organizations
  for each row execute function guard_org_bank_linking();

create or replace function bank_linking_allowed(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (select bank_linking_enabled from site_settings)
     and coalesce((select bank_linking_enabled from organizations where id = p_org_id), false);
$$;

create policy "Connecting a bank must be allowed"
  on enrollments as restrictive for insert to authenticated
  with check (bank_linking_allowed(organization_id));

-- ============================================================================
-- Instance-wide settings, toggled from the Site Admin console, starting with
-- whether anyone can sign up on their own.
--
-- With sign-ups off, the /signup page and action refuse — but Supabase Auth
-- can also be called directly with the public anon key, so the database
-- refuses the new auth.users row itself. Accounts a Site Admin or an org
-- owner creates (auth.admin.createUser) still work: the server records a
-- one-time signup_exemptions row for that email first, and the trigger
-- consumes it. An exemption can't be created from a browser (no policies),
-- and it expires after 10 minutes in case the createUser call failed.
-- ============================================================================

create table site_settings (
  id               boolean primary key default true check (id),
  signups_enabled  boolean not null default true,
  updated_at       timestamptz not null default now()
);

insert into site_settings default values;

alter table site_settings enable row level security;

-- Nothing secret here; the signup page reads it before anyone is signed in.
create policy "Anyone can read site settings"
  on site_settings for select to anon, authenticated
  using (true);

create policy "Site admins can change site settings"
  on site_settings for update to authenticated
  using (is_site_admin())
  with check (is_site_admin());

-- Every change is an administrative action, logged like suspend/delete.
alter table site_admin_actions drop constraint site_admin_actions_action_check;
alter table site_admin_actions add constraint site_admin_actions_action_check
  check (action in ('suspend', 'unsuspend', 'delete', 'promote', 'demote', 'signups_on', 'signups_off'));

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
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_log_site_settings_change
  before update on site_settings
  for each row execute function log_site_settings_change();

create table signup_exemptions (
  email       text primary key,
  created_at  timestamptz not null default now()
);

-- No policies: only the service role (which bypasses RLS) writes these.
alter table signup_exemptions enable row level security;

create or replace function enforce_signups_enabled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select signups_enabled from site_settings) then
    return new;
  end if;

  delete from signup_exemptions
    where email = lower(new.email)
      and created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'Sign-ups are disabled on this instance';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_signups_enabled
  before insert on auth.users
  for each row execute function enforce_signups_enabled();

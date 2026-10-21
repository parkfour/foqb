-- ============================================================================
-- Storage for plugins that can't add migrations of their own: a private
-- plugin (plugins/local, see docs/PLUGINS.md) is built into an instance
-- without ever being in this repository. Each plugin keeps JSON values
-- under its own keys, per book, with the same rules as the book's other
-- data: members read, writers write.
-- ============================================================================

create table plugin_data (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  plugin_id text not null check (plugin_id ~ '^[a-z0-9-]{1,64}$'),
  key text not null check (length(key) between 1 and 200),
  value jsonb not null check (pg_column_size(value) <= 1048576),
  updated_at timestamptz not null default now(),
  unique (organization_id, plugin_id, key)
);

alter table plugin_data enable row level security;

create policy "Members can view plugin data"
  on plugin_data for select
  using (organization_id in (select get_user_org_ids()));
create policy "Writers can add plugin data"
  on plugin_data for insert
  with check (is_org_writer(organization_id));
create policy "Writers can change plugin data"
  on plugin_data for update
  using (is_org_writer(organization_id))
  with check (is_org_writer(organization_id));
create policy "Writers can remove plugin data"
  on plugin_data for delete
  using (is_org_writer(organization_id));
create policy "Require MFA when enrolled"
  on plugin_data as restrictive to authenticated
  using (mfa_satisfied()) with check (mfa_satisfied());

-- A value can't be moved to another book or plugin: write a new key.
create or replace function guard_plugin_data()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id <> old.organization_id or new.plugin_id <> old.plugin_id then
    raise exception 'plugin data stays with its book and plugin';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_plugin_data
  before update on plugin_data
  for each row execute function guard_plugin_data();

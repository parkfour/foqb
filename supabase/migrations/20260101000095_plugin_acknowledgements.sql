-- ============================================================================
-- Plugins that need an acknowledgement before they work (payroll, EU VAT):
-- the plugin declares a disclaimer with a version; it stays off until a
-- Site Admin has acknowledged that version for the instance and an owner
-- has for the book. Each acknowledgement records who and when; a new
-- version of the disclaimer needs acknowledging again. Written only by
-- acknowledge_plugin, which checks the caller's standing; never changed.
-- ============================================================================

create table plugin_acknowledgements (
  id               uuid primary key default gen_random_uuid(),
  -- Null: the instance's, by a Site Admin.
  organization_id  uuid references organizations (id) on delete cascade,
  plugin_id        text not null check (plugin_id ~ '^[a-z0-9-]{1,64}$'),
  version          text not null check (length(version) between 1 and 40),
  acknowledged_by  uuid references auth.users (id) on delete set null,
  acknowledged_at  timestamptz not null default now()
);

create unique index plugin_acknowledgements_key
  on plugin_acknowledgements (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), plugin_id, version);

alter table plugin_acknowledgements enable row level security;

create policy "Signed-in users can view the instance's acknowledgements" on plugin_acknowledgements for select
  to authenticated using (organization_id is null);
create policy "Members can view their books' acknowledgements" on plugin_acknowledgements for select
  using (organization_id in (select get_user_org_ids()));
create policy "Require MFA when enrolled" on plugin_acknowledgements as restrictive to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));

create or replace function acknowledge_plugin(p_plugin_id text, p_version text, p_org_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org_id is null and not is_site_admin() then
    raise exception 'Only a Site Admin can acknowledge this for the instance';
  end if;
  if p_org_id is not null and not is_org_owner(p_org_id) then
    raise exception 'Only an owner can acknowledge this for the book';
  end if;
  insert into plugin_acknowledgements (organization_id, plugin_id, version, acknowledged_by)
  values (p_org_id, p_plugin_id, p_version, auth.uid())
  on conflict do nothing;
end;
$$;
revoke execute on function acknowledge_plugin(text, text, uuid) from public, anon;

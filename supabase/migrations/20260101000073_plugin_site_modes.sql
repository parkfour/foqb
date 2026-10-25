-- ============================================================================
-- Plugins, site-wide. FOQB_PLUGINS (the environment) says which plugins an
-- instance may run; a Site Admin then sets each one, by id, to
--   off     hidden in every book, and its server parts stop
--   choose  off in a book until its owner turns it on (the default)
--   on      on in every book, unless its owner turns it off
-- A plugin not named here is "choose". Each book's own choice stays in
-- plugin_data (key "foqb:config").
-- ============================================================================

alter table site_settings add column plugin_modes jsonb not null default '{}'::jsonb
  check (
    jsonb_typeof(plugin_modes) = 'object'
    and not jsonb_path_exists(plugin_modes, '$.* ? (@ != "off" && @ != "choose" && @ != "on")')
  );

alter table site_admin_actions drop constraint site_admin_actions_action_check;
alter table site_admin_actions add constraint site_admin_actions_action_check
  check (action in (
    'suspend', 'unsuspend', 'delete', 'promote', 'demote',
    'signups_on', 'signups_off', 'banks_on', 'banks_off', 'plugins_changed'
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
  if new.plugin_modes is distinct from old.plugin_modes then
    insert into site_admin_actions (site_admin_id, action)
    values (auth.uid(), 'plugins_changed');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

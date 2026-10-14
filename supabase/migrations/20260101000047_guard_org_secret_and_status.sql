-- ============================================================================
-- Writers can update their organization's settings, and until now that
-- meant every column. Two must not be changed that way:
--
-- * owner_removal_secret_hash: set once, by an owner, through
--   set_owner_removal_secret. A writer could overwrite it directly, then
--   use the new secret to remove the real owners.
-- * status: suspending and unsuspending is a Site Admin action
--   (set_organization_status), not an organization setting.
--
-- Server-side code without a user (auth.uid() is null) is not restricted.
-- ============================================================================

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

  if new.status is distinct from old.status and not is_site_admin() then
    raise exception 'Only a Site Admin can suspend or unsuspend an organization';
  end if;

  return new;
end;
$$;

create trigger trg_guard_org_protected_columns
  before update of owner_removal_secret_hash, status on organizations
  for each row execute function guard_org_protected_columns();

-- Same as before, but marks its own update as the sanctioned way to set
-- the secret (transaction-local, cleared again straight after).
create or replace function set_owner_removal_secret(p_org_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if not is_org_owner(p_org_id) then
    raise exception 'Only an owner can set the owner-removal secret';
  end if;

  if p_secret is null or length(trim(p_secret)) < 8 then
    raise exception 'The owner-removal secret must be at least 8 characters';
  end if;

  perform set_config('app.setting_owner_removal_secret', 'on', true);
  update organizations
    set owner_removal_secret_hash = crypt(p_secret, gen_salt('bf'))
    where id = p_org_id
      and owner_removal_secret_hash is null;
  get diagnostics v_updated = row_count;
  perform set_config('app.setting_owner_removal_secret', '', true);

  if v_updated = 0 then
    raise exception 'This organization already has an owner-removal secret set, or you do not have access to it';
  end if;
end;
$$;

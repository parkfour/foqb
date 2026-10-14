-- ============================================================================
-- The audit log stored whole organization rows, and every member can read
-- it, viewers included. That exposed owner_removal_secret_hash (a bcrypt
-- hash, open to offline guessing) and copied the full logo image into
-- every settings change. Organization rows are now redacted on the way in:
-- the secret becomes true/false (whether one is set) and the logo an MD5
-- fingerprint, so changes to either still show. Existing entries are
-- redacted the same way.
-- ============================================================================

create or replace function audit_redact(p_table text, p_row jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when p_table <> 'organizations' or p_row is null then p_row
    else p_row
      || jsonb_build_object('owner_removal_secret_hash', p_row->>'owner_removal_secret_hash' is not null)
      || case when p_row ? 'logo_data_url'
           then jsonb_build_object('logo_data_url', md5(p_row->>'logo_data_url'))
           else '{}'::jsonb end
  end;
$$;

create or replace function audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_row_id uuid;
begin
  -- organizations' own primary key IS the org id; every other audited
  -- table has a separate organization_id column pointing at it.
  if TG_TABLE_NAME = 'organizations' then
    v_row_id := coalesce(new.id, old.id);
    v_org_id := v_row_id;
  else
    v_row_id := coalesce(new.id, old.id);
    v_org_id := coalesce(new.organization_id, old.organization_id);
  end if;

  insert into audit_log (organization_id, table_name, row_id, action, changed_by, old_data, new_data)
  values (
    v_org_id,
    TG_TABLE_NAME,
    v_row_id,
    lower(TG_OP),
    auth.uid(),
    case when TG_OP in ('UPDATE', 'DELETE') then audit_redact(TG_TABLE_NAME, to_jsonb(old)) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then audit_redact(TG_TABLE_NAME, to_jsonb(new)) else null end
  );

  if TG_OP = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

update audit_log
   set old_data = audit_redact('organizations', old_data),
       new_data = audit_redact('organizations', new_data)
 where table_name = 'organizations';

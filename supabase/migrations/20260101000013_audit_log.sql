-- ============================================================================
-- Audit log: who changed what, when, on the tables that matter for
-- accountability once an org has more than one user (journal entries,
-- invoices/bills, payments, accounts, org settings, membership).
--
-- Deliberately trigger-based (not logged from application code): a helper
-- function called from server actions is easy to forget to call on some new
-- code path, silently leaving a gap. A DB trigger fires on every write to
-- the table regardless of what wrote it — direct SQL, a future API route,
-- a script — so the log can't drift out of sync with reality. There are no
-- insert/update/delete RLS policies on audit_log at all; the only way a row
-- gets written is through this SECURITY DEFINER trigger, which makes the
-- log tamper-proof from the regular API (no client can edit or delete
-- entries, even an org owner).
-- ============================================================================

create table audit_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  table_name       text not null,
  row_id           uuid not null,
  action           text not null check (action in ('insert', 'update', 'delete')),
  changed_by       uuid references auth.users (id),
  changed_at       timestamptz not null default now(),
  old_data         jsonb,
  new_data         jsonb
);

create index idx_audit_log_org_changed_at on audit_log (organization_id, changed_at desc);

alter table audit_log enable row level security;

create policy "Members can view their org's audit log"
  on audit_log for select
  using (organization_id in (select get_user_org_ids()));

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
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  if TG_OP = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

create trigger audit_journal_entries
  after insert or update or delete on journal_entries
  for each row execute function audit_trigger_fn();

create trigger audit_invoices
  after insert or update or delete on invoices
  for each row execute function audit_trigger_fn();

create trigger audit_bills
  after insert or update or delete on bills
  for each row execute function audit_trigger_fn();

create trigger audit_invoice_payments
  after insert or update or delete on invoice_payments
  for each row execute function audit_trigger_fn();

create trigger audit_bill_payments
  after insert or update or delete on bill_payments
  for each row execute function audit_trigger_fn();

create trigger audit_accounts
  after insert or update or delete on accounts
  for each row execute function audit_trigger_fn();

create trigger audit_organizations
  after update on organizations
  for each row execute function audit_trigger_fn();

create trigger audit_organization_members
  after insert or update or delete on organization_members
  for each row execute function audit_trigger_fn();

-- audit_log.changed_by is a raw auth.users id, not exposed to PostgREST via
-- a join into the auth schema (same reason get_org_members exists).
create or replace function get_audit_log(p_org_id uuid, p_limit int default 200)
returns table (
  id uuid,
  table_name text,
  row_id uuid,
  action text,
  changed_by_email text,
  changed_at timestamptz,
  old_data jsonb,
  new_data jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select al.id, al.table_name, al.row_id, al.action, au.email::text, al.changed_at, al.old_data, al.new_data
    from audit_log al
    left join auth.users au on au.id = al.changed_by
    where al.organization_id = p_org_id
      and al.organization_id in (select get_user_org_ids())
    order by al.changed_at desc
    limit p_limit;
$$;

grant execute on function get_audit_log(uuid, int) to authenticated;

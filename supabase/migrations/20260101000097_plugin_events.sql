-- ============================================================================
-- Plugin events the database records, whatever made the change: a page,
-- the bank feed, or a database function (voiding, a bank's correction,
-- applying a credit memo). A background job (lib/plugins/events-outbox.ts)
-- takes them in order and hands each to the plugins' handlers.
--
--   journal_entry:posted       an entry becomes posted
--   bank_transaction:imported  a bank row is added (feed, statement or CSV)
--   period:locked              a book's period lock date changes
--
-- Restoring a backup records none (restore_organization sets
-- foqb.restoring, 20260101000096). Only the service role reads the table;
-- it isn't part of a book's backup.
-- ============================================================================

create table plugin_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table plugin_events enable row level security;
revoke all on plugin_events from anon, authenticated;

create or replace function record_plugin_event(p_org_id uuid, p_event text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('foqb.restoring', true), '') = 'on' then
    return;
  end if;
  insert into plugin_events (organization_id, event, payload) values (p_org_id, p_event, p_payload);
end;
$$;
revoke execute on function record_plugin_event(uuid, text, jsonb) from public, anon, authenticated;

create or replace function plugin_event_entry_posted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'posted' and (tg_op = 'INSERT' or old.status is distinct from 'posted') then
    perform record_plugin_event(new.organization_id, 'journal_entry:posted',
      jsonb_build_object('journalEntryId', new.id, 'entryDate', new.entry_date, 'memo', new.memo));
  end if;
  return new;
end;
$$;

create trigger trg_plugin_event_entry_posted
  after insert or update of status on journal_entries
  for each row execute function plugin_event_entry_posted();

create or replace function plugin_event_bank_imported()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform record_plugin_event(new.organization_id, 'bank_transaction:imported',
    jsonb_build_object('bankTransactionId', new.id, 'accountId', new.account_id, 'date', new.date,
                       'name', new.name, 'amount', new.amount));
  return new;
end;
$$;

create trigger trg_plugin_event_bank_imported
  after insert on bank_transactions
  for each row execute function plugin_event_bank_imported();

create or replace function plugin_event_period_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.period_lock_date is distinct from old.period_lock_date then
    perform record_plugin_event(new.id, 'period:locked',
      jsonb_build_object('lockDate', new.period_lock_date, 'previousLockDate', old.period_lock_date));
  end if;
  return new;
end;
$$;

create trigger trg_plugin_event_period_locked
  after update of period_lock_date on organizations
  for each row execute function plugin_event_period_locked();

-- The job's claim: the oldest events, removed as they're handed over. One
-- lost to a server stopping mid-delivery isn't retried.
create or replace function claim_plugin_events(p_limit integer)
returns setof plugin_events
language sql
security definer
set search_path = public
as $$
  delete from plugin_events
   where id in (select id from plugin_events order by id limit p_limit for update skip locked)
  returning *;
$$;
revoke execute on function claim_plugin_events(integer) from public, anon, authenticated;

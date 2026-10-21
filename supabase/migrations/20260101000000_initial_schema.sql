-- ============================================================================
-- Initial schema: multi-tenant double-entry accounting core
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- A. Multi-tenant organization schema
-- ----------------------------------------------------------------------------

create table organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  period_lock_date   date default null,
  inventory_enabled  boolean not null default false,
  created_at         timestamptz not null default now()
);

create type member_role as enum ('owner', 'accountant', 'viewer');

create table organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             member_role not null default 'owner',
  unique (organization_id, user_id)
);

-- ----------------------------------------------------------------------------
-- B. Double-entry accounting core schema
-- ----------------------------------------------------------------------------

create type account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');

create table accounts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  account_number   varchar(20) not null,
  name             varchar(100) not null,
  type             account_type not null,
  description      text,
  is_active        boolean not null default true,
  unique (organization_id, account_number)
);

create table journal_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  entry_date       date not null,
  memo             text,
  status           varchar(20) not null default 'draft'
                     check (status in ('draft', 'posted', 'void')),
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now()
);

create table journal_lines (
  id                 uuid primary key default gen_random_uuid(),
  journal_entry_id   uuid not null references journal_entries (id) on delete cascade,
  account_id         uuid not null references accounts (id),
  description        text,
  debit              numeric(12, 2) not null default 0.00 check (debit >= 0),
  credit             numeric(12, 2) not null default 0.00 check (credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create table bank_transactions (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references organizations (id) on delete cascade,
  account_id              uuid references accounts (id),
  teller_transaction_id   varchar(100) not null unique,
  teller_account_id       varchar(100),
  date                    date not null,
  name                    varchar(255),
  amount                  numeric(12, 2) not null,
  status                  varchar(20) not null default 'unreconciled'
                            check (status in ('unreconciled', 'matched', 'ignored')),
  journal_entry_id        uuid references journal_entries (id)
);

-- ----------------------------------------------------------------------------
-- C. PL/pgSQL triggers & functions
-- ----------------------------------------------------------------------------

-- Prevents posting an out-of-balance or empty journal entry.
create or replace function verify_journal_entry_balance()
returns trigger
language plpgsql
as $$
declare
  total_debit  numeric(12, 2);
  total_credit numeric(12, 2);
begin
  if new.status = 'posted' then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
      into total_debit, total_credit
      from journal_lines
      where journal_entry_id = new.id;

    if total_debit <> total_credit then
      raise exception
        'Journal entry % cannot be posted: debits (%) do not equal credits (%)',
        new.id, total_debit, total_credit;
    end if;

    if total_debit = 0 then
      raise exception
        'Journal entry % cannot be posted: total debits are zero', new.id;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_verify_journal_entry_balance
  before insert or update on journal_entries
  for each row
  execute function verify_journal_entry_balance();

-- Prevents writes to journal entries dated on or before the organization's period lock date.
create or replace function enforce_period_lock()
returns trigger
language plpgsql
as $$
declare
  lock_date   date;
  target_org  uuid;
  target_date date;
begin
  target_org := coalesce(new.organization_id, old.organization_id);
  target_date := coalesce(new.entry_date, old.entry_date);

  select period_lock_date into lock_date
    from organizations
    where id = target_org;

  if lock_date is not null and target_date <= lock_date then
    raise exception
      'Journal entry date % falls within a locked period (locked through %)',
      target_date, lock_date;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_period_lock
  before insert or update or delete on journal_entries
  for each row
  execute function enforce_period_lock();

-- Returns the organization ids the current authenticated user belongs to.
create or replace function get_user_org_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select organization_id
    from organization_members
    where user_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- D. Row Level Security
-- ----------------------------------------------------------------------------

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table accounts enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
alter table bank_transactions enable row level security;

-- organizations: members can view/update; any authenticated user can create one (bootstrap).
create policy "Members can view their organizations"
  on organizations for select
  using (id in (select get_user_org_ids()));

create policy "Members can update their organizations"
  on organizations for update
  using (id in (select get_user_org_ids()));

create policy "Authenticated users can create organizations"
  on organizations for insert
  with check (auth.uid() is not null);

-- organization_members: members can view; a user may self-insert (bootstrap) or an
-- existing member may manage membership within their organization(s).
create policy "Members can view organization members"
  on organization_members for select
  using (organization_id in (select get_user_org_ids()));

create policy "Members can manage organization members"
  on organization_members for insert
  with check (
    user_id = auth.uid()
    or organization_id in (select get_user_org_ids())
  );

create policy "Members can update organization members"
  on organization_members for update
  using (organization_id in (select get_user_org_ids()));

create policy "Members can remove organization members"
  on organization_members for delete
  using (organization_id in (select get_user_org_ids()));

-- accounts, journal_entries, bank_transactions: scoped directly by organization_id.
create policy "Members can access accounts"
  on accounts for all
  using (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

create policy "Members can access journal entries"
  on journal_entries for all
  using (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

create policy "Members can access bank transactions"
  on bank_transactions for all
  using (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

-- journal_lines: scoped via the parent journal entry's organization.
create policy "Members can access journal lines"
  on journal_lines for all
  using (
    exists (
      select 1 from journal_entries je
      where je.id = journal_lines.journal_entry_id
        and je.organization_id in (select get_user_org_ids())
    )
  )
  with check (
    exists (
      select 1 from journal_entries je
      where je.id = journal_lines.journal_entry_id
        and je.organization_id in (select get_user_org_ids())
    )
  );

-- ----------------------------------------------------------------------------
-- E. Indexes
-- ----------------------------------------------------------------------------

create index idx_journal_entries_org_date on journal_entries (organization_id, entry_date);
create index idx_journal_lines_entry_account on journal_lines (journal_entry_id, account_id);
create index idx_bank_transactions_org_status on bank_transactions (organization_id, status);

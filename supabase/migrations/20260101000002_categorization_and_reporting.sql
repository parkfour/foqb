-- ============================================================================
-- Categorization rules engine & financial reporting RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Categorization rules schema
-- ----------------------------------------------------------------------------

create table categorization_rules (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  target_account_id  uuid not null references accounts (id) on delete cascade,
  rule_name          varchar(100) not null,
  match_type         varchar(20) not null
                       check (match_type in ('contains', 'exact', 'starts_with', 'regex')),
  match_text         varchar(255) not null,
  transaction_type   varchar(10) not null default 'any'
                       check (transaction_type in ('debit', 'credit', 'any')),
  min_amount         numeric(12, 2),
  max_amount         numeric(12, 2),
  priority           integer not null default 10,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create index idx_categorization_rules_org_priority
  on categorization_rules (organization_id, priority asc)
  where is_active = true;

alter table categorization_rules enable row level security;

create policy "Members can access categorization rules"
  on categorization_rules for all
  using (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

-- ----------------------------------------------------------------------------
-- B. Pattern-matching function
-- ----------------------------------------------------------------------------

create or replace function match_bank_transaction(
  p_org_id uuid,
  p_description text,
  p_amount numeric
)
returns uuid
language plpgsql
stable
as $$
declare
  v_transaction_type text;
  r record;
begin
  v_transaction_type := case
    when p_amount < 0 then 'debit'
    when p_amount > 0 then 'credit'
    else 'any'
  end;

  for r in
    select *
      from categorization_rules
      where organization_id = p_org_id
        and is_active = true
      order by priority asc
  loop
    if r.transaction_type <> 'any' and r.transaction_type <> v_transaction_type then
      continue;
    end if;

    if r.min_amount is not null and abs(p_amount) < r.min_amount then
      continue;
    end if;

    if r.max_amount is not null and abs(p_amount) > r.max_amount then
      continue;
    end if;

    if (r.match_type = 'contains' and p_description ilike '%' || r.match_text || '%')
      or (r.match_type = 'starts_with' and p_description ilike r.match_text || '%')
      or (r.match_type = 'exact' and p_description ilike r.match_text)
      or (r.match_type = 'regex' and p_description ~* r.match_text)
    then
      return r.target_account_id;
    end if;
  end loop;

  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- C. Financial reporting RPCs
-- ----------------------------------------------------------------------------

-- Trial balance: per-account debit/credit totals and signed balance as of a date.
create or replace function get_trial_balance(p_org_id uuid, p_as_of_date date)
returns table (
  account_id      uuid,
  account_number  varchar,
  name            varchar,
  type            account_type,
  total_debit     numeric,
  total_credit    numeric,
  balance         numeric
)
language sql
stable
as $$
  select
    a.id as account_id,
    a.account_number,
    a.name,
    a.type,
    coalesce(t.total_debit, 0) as total_debit,
    coalesce(t.total_credit, 0) as total_credit,
    case
      when a.type in ('asset', 'expense')
        then coalesce(t.total_debit, 0) - coalesce(t.total_credit, 0)
      else coalesce(t.total_credit, 0) - coalesce(t.total_debit, 0)
    end as balance
  from accounts a
  left join (
    select
      jl.account_id,
      sum(jl.debit) as total_debit,
      sum(jl.credit) as total_credit
    from journal_lines jl
    join journal_entries je
      on je.id = jl.journal_entry_id
     and je.status = 'posted'
     and je.entry_date <= p_as_of_date
    group by jl.account_id
  ) t on t.account_id = a.id
  where a.organization_id = p_org_id
  order by a.account_number;
$$;

-- Income statement: revenue/expense accounts with net period amounts.
create or replace function get_income_statement(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  account_id      uuid,
  account_number  varchar,
  name            varchar,
  type            account_type,
  amount          numeric
)
language sql
stable
as $$
  select
    a.id as account_id,
    a.account_number,
    a.name,
    a.type,
    case
      when a.type = 'revenue' then coalesce(t.total_credit, 0) - coalesce(t.total_debit, 0)
      else coalesce(t.total_debit, 0) - coalesce(t.total_credit, 0)
    end as amount
  from accounts a
  left join (
    select
      jl.account_id,
      sum(jl.debit) as total_debit,
      sum(jl.credit) as total_credit
    from journal_lines jl
    join journal_entries je
      on je.id = jl.journal_entry_id
     and je.status = 'posted'
     and je.entry_date between p_start_date and p_end_date
    group by jl.account_id
  ) t on t.account_id = a.id
  where a.organization_id = p_org_id
    and a.type in ('revenue', 'expense')
  order by a.type, a.account_number;
$$;

-- Retained earnings: cumulative net income (revenue - expense) across all
-- historical posted entries up to a date. For revenue and expense accounts,
-- credit - debit is the natural contribution to net income for both types.
create or replace function get_retained_earnings(p_org_id uuid, p_as_of_date date)
returns numeric
language sql
stable
as $$
  select coalesce(sum(jl.credit - jl.debit), 0)
    from journal_lines jl
    join journal_entries je
      on je.id = jl.journal_entry_id
     and je.status = 'posted'
     and je.entry_date <= p_as_of_date
    join accounts a
      on a.id = jl.account_id
     and a.type in ('revenue', 'expense')
    where a.organization_id = p_org_id;
$$;

-- Balance sheet: ending balances for asset/liability/equity accounts as of a
-- date, plus a synthetic Retained Earnings row under equity.
create or replace function get_balance_sheet(p_org_id uuid, p_as_of_date date)
returns table (
  account_id      uuid,
  account_number  varchar,
  name            varchar,
  type            account_type,
  balance         numeric
)
language plpgsql
stable
as $$
begin
  return query
    select
      a.id as account_id,
      a.account_number,
      a.name,
      a.type,
      case
        when a.type = 'asset' then coalesce(t.total_debit, 0) - coalesce(t.total_credit, 0)
        else coalesce(t.total_credit, 0) - coalesce(t.total_debit, 0)
      end as balance
    from accounts a
    left join (
      select
        jl.account_id,
        sum(jl.debit) as total_debit,
        sum(jl.credit) as total_credit
      from journal_lines jl
      join journal_entries je
        on je.id = jl.journal_entry_id
       and je.status = 'posted'
       and je.entry_date <= p_as_of_date
      group by jl.account_id
    ) t on t.account_id = a.id
    where a.organization_id = p_org_id
      and a.type in ('asset', 'liability', 'equity')
    order by a.type, a.account_number;

  return query
    select
      null::uuid as account_id,
      null::varchar as account_number,
      'Retained Earnings'::varchar as name,
      'equity'::account_type as type,
      get_retained_earnings(p_org_id, p_as_of_date) as balance;
end;
$$;

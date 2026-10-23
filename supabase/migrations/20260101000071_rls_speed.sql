-- ============================================================================
-- Row-level security made the reports and every listing slow.
--
-- 1. The restrictive "Require MFA when enrolled" policy on each table
--    (20260101000034) called mfa_satisfied() bare, so Postgres could run it
--    for every row, each run reading the JWT and auth.mfa_factors. As
--    (select mfa_satisfied()) it runs once per query, as Supabase's RLS
--    guidance has it. Same check.
--
-- 2. The report functions ran as the caller, so every journal line they
--    added up went through RLS, and several summed every visible line in
--    the database before keeping their book's: a balance sheet of 20,000
--    lines took 1,241 ms as a user, 24 ms without RLS. They now run as the
--    definer, refuse a book that isn't one of the caller's
--    (get_user_org_ids, which also holds an MFA-enrolled user to MFA), and
--    read only their book's entries. Anon can't call them. Otherwise as of 20260101000002,
--    20260101000016, 20260101000063 and 20260101000067.
-- ============================================================================

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename from pg_policies where policyname = 'Require MFA when enrolled'
  loop
    execute format(
      'alter policy "Require MFA when enrolled" on %I.%I using ((select mfa_satisfied())) with check ((select mfa_satisfied()))',
      p.schemaname, p.tablename
    );
  end loop;
end
$$;

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
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A signed-in user's own books only. Without a user it's a trusted
  -- connection (the SQL editor, the service role): anon can't call it.
  if auth.uid() is not null and (p_org_id is null or p_org_id not in (select get_user_org_ids())) then
    raise exception 'Not one of your books';
  end if;
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
       and je.organization_id = p_org_id
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

create or replace function get_income_statement(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  account_id      uuid,
  account_number  varchar,
  name            varchar,
  type            account_type,
  amount          numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A signed-in user's own books only. Without a user it's a trusted
  -- connection (the SQL editor, the service role): anon can't call it.
  if auth.uid() is not null and (p_org_id is null or p_org_id not in (select get_user_org_ids())) then
    raise exception 'Not one of your books';
  end if;
  return query
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
     and je.organization_id = p_org_id
     and je.entry_date between p_start_date and p_end_date
    group by jl.account_id
  ) t on t.account_id = a.id
  where a.organization_id = p_org_id
    and a.type in ('revenue', 'expense')
  order by a.type, a.account_number;
end;
$$;

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
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A signed-in user's own books only. Without a user it's a trusted
  -- connection (the SQL editor, the service role): anon can't call it.
  if auth.uid() is not null and (p_org_id is null or p_org_id not in (select get_user_org_ids())) then
    raise exception 'Not one of your books';
  end if;
  return query
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
     and je.organization_id = p_org_id
     and je.entry_date <= p_as_of_date
    group by jl.account_id
  ) t on t.account_id = a.id
  where a.organization_id = p_org_id
  order by a.account_number;
end;
$$;

create or replace function get_account_ledger(
  p_org_id uuid,
  p_account_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  entry_id     uuid,
  entry_date   date,
  memo         text,
  description  text,
  debit        numeric,
  credit       numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A signed-in user's own books only. Without a user it's a trusted
  -- connection (the SQL editor, the service role): anon can't call it.
  if auth.uid() is not null and (p_org_id is null or p_org_id not in (select get_user_org_ids())) then
    raise exception 'Not one of your books';
  end if;
  return query
  select
    je.id as entry_id,
    je.entry_date,
    je.memo,
    jl.description,
    jl.debit,
    jl.credit
  from journal_lines jl
  join journal_entries je
    on je.id = jl.journal_entry_id
   and je.status = 'posted'
   and je.organization_id = p_org_id
   and (p_start_date is null or je.entry_date >= p_start_date)
   and je.entry_date <= p_end_date
  where jl.account_id = p_account_id
  order by je.entry_date, je.id;
end;
$$;

create or replace function get_tax_line_report(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  tax_line_id   uuid,
  form          varchar,
  code          varchar,
  label         varchar,
  sort_order    integer,
  property_id   uuid,
  property_name text,
  account_type  account_type,
  amount        numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A signed-in user's own books only. Without a user it's a trusted
  -- connection (the SQL editor, the service role): anon can't call it.
  if auth.uid() is not null and (p_org_id is null or p_org_id not in (select get_user_org_ids())) then
    raise exception 'Not one of your books';
  end if;
  return query
  with activity as (
    select
      a.tax_line_id,
      a.property_id,
      a.type,
      case
        when a.type = 'revenue' then coalesce(t.total_credit, 0) - coalesce(t.total_debit, 0)
        else coalesce(t.total_debit, 0) - coalesce(t.total_credit, 0)
      end as amount
    from accounts a
    left join (
      select jl.account_id, sum(jl.debit) as total_debit, sum(jl.credit) as total_credit
      from journal_lines jl
      join journal_entries je
        on je.id = jl.journal_entry_id
       and je.status = 'posted'
       and je.organization_id = p_org_id
       and je.entry_date between p_start_date and p_end_date
      group by jl.account_id
    ) t on t.account_id = a.id
    where a.organization_id = p_org_id
      and a.type in ('revenue', 'expense')
  )
  select
    tl.id as tax_line_id,
    tl.form,
    tl.code,
    tl.label,
    tl.sort_order,
    act.property_id,
    p.name as property_name,
    act.type as account_type,
    sum(act.amount) as amount
  from activity act
  join tax_lines tl on tl.id = act.tax_line_id
  left join properties p on p.id = act.property_id
  group by tl.id, tl.form, tl.code, tl.label, tl.sort_order, act.property_id, p.name, act.type
  union all
  select
    null::uuid as tax_line_id,
    null::varchar as form,
    null::varchar as code,
    ('Unassigned ' || initcap(act.type::text))::varchar as label,
    999999 as sort_order,
    null::uuid as property_id,
    null::text as property_name,
    act.type as account_type,
    sum(act.amount) as amount
  from activity act
  where act.tax_line_id is null
  group by act.type
  order by form nulls last, property_name nulls first, sort_order, label;
end;
$$;

create or replace function get_tax_line_accounts(
  p_org_id uuid,
  p_tax_line_id uuid,
  p_type account_type,
  p_start_date date,
  p_end_date date,
  p_property_id uuid default null
)
returns table (
  account_id      uuid,
  account_number  varchar,
  name            varchar,
  type            account_type,
  amount          numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A signed-in user's own books only. Without a user it's a trusted
  -- connection (the SQL editor, the service role): anon can't call it.
  if auth.uid() is not null and (p_org_id is null or p_org_id not in (select get_user_org_ids())) then
    raise exception 'Not one of your books';
  end if;
  return query
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
    select jl.account_id, sum(jl.debit) as total_debit, sum(jl.credit) as total_credit
    from journal_lines jl
    join journal_entries je
      on je.id = jl.journal_entry_id
     and je.status = 'posted'
     and je.organization_id = p_org_id
     and je.entry_date between p_start_date and p_end_date
    group by jl.account_id
  ) t on t.account_id = a.id
  where a.organization_id = p_org_id
    and a.type in ('revenue', 'expense')
    and (
      (p_tax_line_id is not null and a.tax_line_id = p_tax_line_id and a.property_id is not distinct from p_property_id)
      or (p_tax_line_id is null and a.tax_line_id is null and a.type = p_type)
    )
  order by a.account_number;
end;
$$;

create or replace function get_net_worth_series(p_org_id uuid, p_dates date[])
returns table (as_of date, total_assets numeric, total_liabilities numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- A signed-in user's own books only. Without a user it's a trusted
  -- connection (the SQL editor, the service role): anon can't call it.
  if auth.uid() is not null and (p_org_id is null or p_org_id not in (select get_user_org_ids())) then
    raise exception 'Not one of your books';
  end if;
  return query
  with changes as (
    select
      je.entry_date,
      sum(case when a.type = 'asset' then jl.debit - jl.credit else 0 end) as assets,
      sum(case when a.type = 'liability' then jl.credit - jl.debit else 0 end) as liabilities
    from journal_lines jl
    join journal_entries je
      on je.id = jl.journal_entry_id
     and je.status = 'posted'
     and je.organization_id = p_org_id
    join accounts a
      on a.id = jl.account_id
     and a.organization_id = p_org_id
     and a.type in ('asset', 'liability')
    group by je.entry_date
  )
  select x.as_of, coalesce(sum(c.assets), 0), coalesce(sum(c.liabilities), 0)
  from unnest(p_dates) as x(as_of)
  left join changes c on c.entry_date <= x.as_of
  group by x.as_of
  order by x.as_of;
end;
$$;

revoke execute on function get_balance_sheet(uuid, date) from public, anon;
revoke execute on function get_income_statement(uuid, date, date) from public, anon;
revoke execute on function get_trial_balance(uuid, date) from public, anon;
revoke execute on function get_account_ledger(uuid, uuid, date, date) from public, anon;
revoke execute on function get_tax_line_report(uuid, date, date) from public, anon;
revoke execute on function get_tax_line_accounts(uuid, uuid, account_type, date, date, uuid) from public, anon;
revoke execute on function get_net_worth_series(uuid, date[]) from public, anon;

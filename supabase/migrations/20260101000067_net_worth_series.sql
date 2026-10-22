-- ============================================================================
-- Net worth over time from the books: for each date asked, what the asset
-- and liability accounts held at the end of that day, worked out from the
-- posted entries the way get_balance_sheet does for one date. The net worth
-- chart draws from this instead of only the snapshots saved on dashboard
-- visits, so it has a history from the first entry on. Properties' values
-- are added by the app.
-- ============================================================================

create or replace function get_net_worth_series(p_org_id uuid, p_dates date[])
returns table (as_of date, total_assets numeric, total_liabilities numeric)
language sql
stable
set search_path = public
as $$
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
$$;

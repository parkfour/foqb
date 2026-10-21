-- ============================================================================
-- Account ledger: the individual posted journal lines behind a single
-- account's balance, for drilling down from a report figure (Trial Balance /
-- Income Statement / Balance Sheet) to the transactions that comprise it.
-- p_start_date is nullable: null means "from inception," used by the
-- as-of-date reports (Trial Balance, Balance Sheet), which show a cumulative
-- balance rather than a period balance.
-- ============================================================================

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
language sql
stable
as $$
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
$$;

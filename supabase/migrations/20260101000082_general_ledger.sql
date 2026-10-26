-- General Ledger: every posted line in a period, for all of a book's
-- accounts at once (get_account_ledger is one account at a time). The
-- report adds each account's opening balance from get_trial_balance.
create or replace function get_general_ledger(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  account_id   uuid,
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
    jl.account_id,
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
   and je.entry_date >= p_start_date
   and je.entry_date <= p_end_date
  order by jl.account_id, je.entry_date, je.id;
end;
$$;
revoke execute on function get_general_ledger(uuid, date, date) from public, anon;

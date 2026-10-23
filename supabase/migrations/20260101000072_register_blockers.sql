-- ============================================================================
-- The register's per-row checks without a per-row membership check.
-- reopen_blocker and recategorize_blocker (20260101000070) confirm on every
-- call that the row is in one of the caller's books, so a register page of
-- 1,000 rows asked that 2,000 times. bank_transaction_blockers answers for a
-- list of rows at once, checking membership once (rows outside the
-- caller's books are left out). The checks themselves move to
-- *_unchecked functions that only these call; reopen_blocker and
-- recategorize_blocker keep their guard for the functions that re-open and
-- re-categorize, and for Bank Transactions.
-- ============================================================================

create or replace function reopen_blocker_unchecked(bt bank_transactions)
returns text
language sql
stable
as $$
  select case
    when bt.journal_entry_id is null then
      'There is no journal entry to re-open'
    when exists (
      select 1 from public.invoice_payments p
       where p.journal_entry_id = bt.journal_entry_id or p.bank_transaction_id = bt.id
    ) then
      'Matched to an invoice payment — adjust the payment yourself, then dismiss'
    when exists (
      select 1 from public.bill_payments p
       where p.journal_entry_id = bt.journal_entry_id or p.bank_transaction_id = bt.id
    ) then
      'Matched to a bill payment — adjust the payment yourself, then dismiss'
    when exists (
      select 1 from public.journal_lines jl
       where jl.journal_entry_id = bt.journal_entry_id and jl.reconciliation_id is not null
    ) then
      'Part of a bank reconciliation — review it yourself, then dismiss'
    when exists (
      select 1 from public.organizations o
        join public.journal_entries je on je.id = bt.journal_entry_id
       where o.id = bt.organization_id
         and o.period_lock_date is not null
         and (je.entry_date <= o.period_lock_date
              or (bt.bank_change->>'date')::date <= o.period_lock_date)
    ) then
      'In a locked period — review it yourself, then dismiss'
  end;
$$;

create or replace function recategorize_blocker_unchecked(bt bank_transactions)
returns text
language sql
stable
as $$
  select case
    when bt.journal_entry_id is null or bt.status <> 'matched' then
      'Only a categorized transaction''s category can be changed'
    when exists (
      select 1 from public.invoice_payments p
       where p.journal_entry_id = bt.journal_entry_id or p.bank_transaction_id = bt.id
    ) then
      'Matched to an invoice payment — change the payment instead'
    when exists (
      select 1 from public.bill_payments p
       where p.journal_entry_id = bt.journal_entry_id or p.bank_transaction_id = bt.id
    ) then
      'Matched to a bill payment — change the payment instead'
    when exists (
      select 1 from public.bank_transactions other
       where other.journal_entry_id = bt.journal_entry_id and other.id <> bt.id
    ) then
      'A transfer between two of your accounts — re-open it to change it'
    when (
      select count(*) from public.journal_lines jl
       where jl.journal_entry_id = bt.journal_entry_id and jl.account_id <> bt.account_id
    ) <> 1 then
      'A split — re-book it from Journal Entries'
    when exists (
      select 1 from public.organizations o
        join public.journal_entries je on je.id = bt.journal_entry_id
       where o.id = bt.organization_id
         and o.period_lock_date is not null
         and je.entry_date <= o.period_lock_date
    ) then
      'In a locked period'
  end;
$$;

revoke execute on function reopen_blocker_unchecked(bank_transactions) from public, anon, authenticated;
revoke execute on function recategorize_blocker_unchecked(bank_transactions) from public, anon, authenticated;

create or replace function reopen_blocker(bt bank_transactions)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when bt.organization_id not in (select get_user_org_ids()) then 'Not in one of your books'
    else reopen_blocker_unchecked(bt)
  end;
$$;

create or replace function recategorize_blocker(bt bank_transactions)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when bt.organization_id not in (select get_user_org_ids()) then 'Not in one of your books'
    else recategorize_blocker_unchecked(bt)
  end;
$$;

-- Why each of these rows can't be re-opened, or have its category changed
-- in place (null where it can), for the rows in the caller's books.
create or replace function bank_transaction_blockers(p_ids uuid[])
returns table (id uuid, reopen_blocker text, recategorize_blocker text)
language sql
stable
security definer
set search_path = public
as $$
  select bt.id, reopen_blocker_unchecked(bt), recategorize_blocker_unchecked(bt)
    from bank_transactions bt
   where bt.id = any(p_ids)
     and bt.organization_id in (select get_user_org_ids());
$$;

revoke execute on function bank_transaction_blockers(uuid[]) from public, anon;

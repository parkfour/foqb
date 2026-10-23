-- ============================================================================
-- reopen_blocker and recategorize_blocker run for every row the register and
-- Bank Transactions list, and each makes several lookups. As the caller,
-- every lookup also applied row-level security, which looks up the caller's
-- books each time: for 1,000 rows that was most of the page's time (1,436 ms,
-- against 165 ms without them). As the definer they skip that, and instead
-- answer only for a row in one of the caller's books (get_user_org_ids,
-- which also holds an MFA-enrolled user to MFA), refusing any other: 279 ms.
-- Otherwise as of 20260101000038 and 20260101000061.
-- ============================================================================

create or replace function reopen_blocker(bt bank_transactions)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when bt.organization_id not in (select get_user_org_ids()) then
      'Not in one of your books'
    when bt.journal_entry_id is null then
      'There is no journal entry to re-open'
    when exists (
      select 1 from invoice_payments p
       where p.journal_entry_id = bt.journal_entry_id or p.bank_transaction_id = bt.id
    ) then
      'Matched to an invoice payment — adjust the payment yourself, then dismiss'
    when exists (
      select 1 from bill_payments p
       where p.journal_entry_id = bt.journal_entry_id or p.bank_transaction_id = bt.id
    ) then
      'Matched to a bill payment — adjust the payment yourself, then dismiss'
    when exists (
      select 1 from journal_lines jl
       where jl.journal_entry_id = bt.journal_entry_id and jl.reconciliation_id is not null
    ) then
      'Part of a bank reconciliation — review it yourself, then dismiss'
    when exists (
      select 1 from organizations o
        join journal_entries je on je.id = bt.journal_entry_id
       where o.id = bt.organization_id
         and o.period_lock_date is not null
         and (je.entry_date <= o.period_lock_date
              or (bt.bank_change->>'date')::date <= o.period_lock_date)
    ) then
      'In a locked period — review it yourself, then dismiss'
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
    when bt.organization_id not in (select get_user_org_ids()) then
      'Not in one of your books'
    when bt.journal_entry_id is null or bt.status <> 'matched' then
      'Only a categorized transaction''s category can be changed'
    when exists (
      select 1 from invoice_payments p
       where p.journal_entry_id = bt.journal_entry_id or p.bank_transaction_id = bt.id
    ) then
      'Matched to an invoice payment — change the payment instead'
    when exists (
      select 1 from bill_payments p
       where p.journal_entry_id = bt.journal_entry_id or p.bank_transaction_id = bt.id
    ) then
      'Matched to a bill payment — change the payment instead'
    when exists (
      select 1 from bank_transactions other
       where other.journal_entry_id = bt.journal_entry_id and other.id <> bt.id
    ) then
      'A transfer between two of your accounts — re-open it to change it'
    when (
      select count(*) from journal_lines jl
       where jl.journal_entry_id = bt.journal_entry_id and jl.account_id <> bt.account_id
    ) <> 1 then
      'A split — re-book it from Journal Entries'
    when exists (
      select 1 from organizations o
        join journal_entries je on je.id = bt.journal_entry_id
       where o.id = bt.organization_id
         and o.period_lock_date is not null
         and je.entry_date <= o.period_lock_date
    ) then
      'In a locked period'
  end;
$$;

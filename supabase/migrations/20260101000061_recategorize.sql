-- ============================================================================
-- Changing a categorized bank transaction's category without re-opening it,
-- so it works on a reconciled one too. Re-opening voids the entry and sends
-- the row back to the feed, which would undo its reconciliation; but a new
-- category leaves the bank side (account, date, amount) as it was, so the
-- reconciliation still holds. recategorize_bank_transaction() re-books the
-- entry with the category line on the new account and every other line,
-- reconciliation included, unchanged, then voids the old entry: the change
-- stays on the record.
-- ============================================================================

-- Why a categorized row's category can't be changed here, or null if it can.
create or replace function recategorize_blocker(bt bank_transactions)
returns text
language sql
stable
set search_path = public
as $$
  select case
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

create or replace function recategorize_bank_transaction(p_bank_transaction_id uuid, p_account_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_bt bank_transactions%rowtype;
  v_entry journal_entries%rowtype;
  v_blocker text;
  v_new uuid;
begin
  select * into v_bt from bank_transactions where id = p_bank_transaction_id for update;
  if not found or not is_org_writer(v_bt.organization_id) then
    raise exception 'You can''t change this transaction';
  end if;

  v_blocker := recategorize_blocker(v_bt);
  if v_blocker is not null then
    raise exception '%', v_blocker;
  end if;

  if not exists (
    select 1 from accounts
     where id = p_account_id and organization_id = v_bt.organization_id and is_active and id <> v_bt.account_id
  ) then
    raise exception 'Choose another of this book''s active accounts';
  end if;
  if exists (
    select 1 from journal_lines
     where journal_entry_id = v_bt.journal_entry_id and account_id <> v_bt.account_id and account_id = p_account_id
  ) then
    return v_bt.journal_entry_id; -- already there
  end if;

  select * into v_entry from journal_entries where id = v_bt.journal_entry_id;

  -- Re-booked as a draft and then posted, as every entry is; the bank
  -- line keeps its reconciliation.
  insert into journal_entries (organization_id, entry_date, memo, status, created_by)
  values (v_entry.organization_id, v_entry.entry_date, v_entry.memo, 'draft', auth.uid())
  returning id into v_new;
  insert into journal_lines (journal_entry_id, account_id, description, debit, credit, reconciliation_id)
  select v_new,
         case when jl.account_id = v_bt.account_id then jl.account_id else p_account_id end,
         jl.description, jl.debit, jl.credit, jl.reconciliation_id
    from journal_lines jl
   where jl.journal_entry_id = v_entry.id;
  update journal_entries set status = 'posted' where id = v_new;

  update journal_lines set reconciliation_id = null where journal_entry_id = v_entry.id;
  update journal_entries set status = 'void' where id = v_entry.id;
  update bank_transactions set journal_entry_id = v_new where id = v_bt.id;
  return v_new;
end;
$$;

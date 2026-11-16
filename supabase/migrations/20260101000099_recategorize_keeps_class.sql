-- ============================================================================
-- Changing a categorized bank transaction's category (migration 061)
-- re-books its lines, but copied only account, amounts and reconciliation:
-- a line's class (089) and foreign-currency amount and rate (093) were
-- dropped. The re-booked lines now keep them.
-- ============================================================================

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
  -- line keeps its reconciliation, and every line its class and foreign
  -- amount.
  insert into journal_entries (organization_id, entry_date, memo, status, created_by)
  values (v_entry.organization_id, v_entry.entry_date, v_entry.memo, 'draft', auth.uid())
  returning id into v_new;
  insert into journal_lines (journal_entry_id, account_id, description, debit, credit, reconciliation_id, class_id, foreign_amount, exchange_rate)
  select v_new,
         case when jl.account_id = v_bt.account_id then jl.account_id else p_account_id end,
         jl.description, jl.debit, jl.credit, jl.reconciliation_id, jl.class_id,
         case when jl.account_id = v_bt.account_id then jl.foreign_amount end,
         case when jl.account_id = v_bt.account_id then jl.exchange_rate end
    from journal_lines jl
   where jl.journal_entry_id = v_entry.id;
  update journal_entries set status = 'posted' where id = v_new;

  update journal_lines set reconciliation_id = null where journal_entry_id = v_entry.id;
  update journal_entries set status = 'void' where id = v_entry.id;
  update bank_transactions set journal_entry_id = v_new where id = v_bt.id;
  return v_new;
end;
$$;

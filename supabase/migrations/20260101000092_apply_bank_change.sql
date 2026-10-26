-- ============================================================================
-- A bank's change to a matched transaction (bank_change, migration 038) is
-- applied by itself when that's safe: the entry is the plain two-line kind
-- (this bank account and one category), nothing else depends on it
-- (reopen_blocker_unchecked: no payment, reconciliation or locked period),
-- no other bank row shares it (a transfer), and the money still goes the
-- same way. The old entry is voided and a new one posted with the same
-- accounts and descriptions at the bank's amount and date.
-- Anything else stays held for a person, as before. Returns whether it
-- applied.
-- ============================================================================

create or replace function apply_bank_change(p_bank_transaction_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bt bank_transactions%rowtype;
  v_entry journal_entries%rowtype;
  v_amount numeric;
  v_date date;
  v_new_entry uuid := gen_random_uuid();
begin
  select * into v_bt from bank_transactions where id = p_bank_transaction_id for update;
  if not found or v_bt.status <> 'matched' or v_bt.bank_change is null then
    return false;
  end if;
  if auth.uid() is not null and not is_org_writer(v_bt.organization_id) then
    raise exception 'Bank transaction not found';
  end if;

  v_amount := (v_bt.bank_change->>'amount')::numeric;
  v_date := coalesce((v_bt.bank_change->>'date')::date, v_bt.date);
  if v_amount is null or v_amount = 0 or sign(v_amount) <> sign(v_bt.amount)
     or reopen_blocker_unchecked(v_bt) is not null
     or exists (select 1 from organizations where id = v_bt.organization_id and period_lock_date >= v_date)
     or (select count(*) from journal_lines where journal_entry_id = v_bt.journal_entry_id) <> 2
     or not exists (select 1 from journal_lines where journal_entry_id = v_bt.journal_entry_id and account_id = v_bt.account_id)
     or exists (select 1 from bank_transactions where journal_entry_id = v_bt.journal_entry_id and id <> v_bt.id) then
    return false;
  end if;

  select * into v_entry from journal_entries where id = v_bt.journal_entry_id;

  insert into journal_entries (id, organization_id, entry_date, memo, status, created_by)
  values (v_new_entry, v_bt.organization_id, v_date, v_entry.memo, 'draft', v_entry.created_by);

  -- Each line keeps its side; only the amount changes.
  insert into journal_lines (journal_entry_id, account_id, description, debit, credit)
  select v_new_entry, account_id, description,
         case when debit > 0 then abs(v_amount) else 0 end,
         case when credit > 0 then abs(v_amount) else 0 end
  from journal_lines where journal_entry_id = v_entry.id;

  update journal_entries set status = 'posted' where id = v_new_entry;
  update journal_entries set status = 'void' where id = v_entry.id;
  update bank_transactions
     set journal_entry_id = v_new_entry, amount = v_amount, date = v_date, bank_change = null
   where id = v_bt.id;
  return true;
end;
$$;
revoke execute on function apply_bank_change(uuid) from public, anon;

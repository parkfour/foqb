-- ============================================================================
-- Bank feed improvements:
--
-- 1. What the bank says: each linked account keeps the balance Plaid last
--    reported, and when; each bank transaction records when it arrived;
--    each connection records when it last synced.
-- 2. Re-opening: any categorized or ignored bank transaction can go back to
--    uncategorized, not only one the bank changed, unless it's tied to a
--    payment, a reconciliation or a locked period (reopen_blocker).
-- 3. Transfers between two linked accounts are one journal entry for both
--    bank rows. Whichever side is categorized first (to the other account)
--    books the entry; its counterpart, already in the feed or arriving
--    later, is matched to that same entry instead of being booked again.
-- 4. An account's type can't change once it has journal lines, since that
--    would silently move past amounts between the balance sheet and P&L.
-- ============================================================================

alter table accounts
  add column bank_balance numeric(14, 2),
  add column bank_available numeric(14, 2),
  add column bank_balance_at timestamptz;

-- Existing rows stay null: when they arrived wasn't recorded.
alter table bank_transactions add column received_at timestamptz;
alter table bank_transactions alter column received_at set default now();

alter table enrollments add column last_synced_at timestamptz;
grant select (last_synced_at) on enrollments to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Re-opening
-- ----------------------------------------------------------------------------

create or replace function reopen_bank_transaction(p_bank_transaction_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_bt bank_transactions%rowtype;
  v_blocker text;
begin
  select * into v_bt from bank_transactions where id = p_bank_transaction_id for update;

  if not found or v_bt.status not in ('matched', 'ignored') then
    raise exception 'Only a categorized or ignored transaction can be re-opened';
  end if;

  if v_bt.status = 'ignored' then
    update bank_transactions set status = 'unreconciled' where id = v_bt.id;
    return;
  end if;

  v_blocker := reopen_blocker(v_bt);
  if v_blocker is not null then
    raise exception '%', v_blocker;
  end if;

  update journal_entries set status = 'void' where id = v_bt.journal_entry_id;

  -- Every bank row on the entry: both sides of a transfer go back together.
  -- A held bank change is applied on the way.
  update bank_transactions
     set status = 'unreconciled',
         journal_entry_id = null,
         amount = coalesce((bank_change->>'amount')::numeric, amount),
         date = coalesce((bank_change->>'date')::date, date),
         bank_change = null
   where journal_entry_id = v_bt.journal_entry_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Transfers. The 5-day window is TRANSFER_WINDOW_DAYS in
--    lib/bank/transfers.ts too; keep them the same.
-- ----------------------------------------------------------------------------

-- A new feed row whose transfer is already booked: the entry has a line on
-- this row's account for this amount, came from a bank row in another
-- account, and has no bank row in this account yet.
create or replace function match_booked_transfer()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_entry uuid;
begin
  if new.status <> 'unreconciled' or new.account_id is null then
    return new;
  end if;

  select je.id into v_entry
    from journal_entries je
    join journal_lines jl on jl.journal_entry_id = je.id and jl.account_id = new.account_id
   where je.organization_id = new.organization_id
     and je.status = 'posted'
     and jl.debit - jl.credit = new.amount
     and abs(je.entry_date - new.date) <= 5
     and exists (select 1 from bank_transactions o
                  where o.journal_entry_id = je.id and o.account_id <> new.account_id)
     and not exists (select 1 from bank_transactions o
                      where o.journal_entry_id = je.id and o.account_id = new.account_id)
   order by abs(je.entry_date - new.date), je.id
   limit 1;

  if v_entry is not null then
    new.status := 'matched';
    new.journal_entry_id := v_entry;
  end if;
  return new;
end;
$$;

create trigger trg_match_booked_transfer
  before insert on bank_transactions
  for each row execute function match_booked_transfer();

-- A row just booked: for each other account its entry touches, the
-- uncategorized feed row there with that amount (nearest date) is the other
-- side of the same transfer, so it joins the entry. That row's own pass
-- finds nothing left to do, since this row is no longer uncategorized.
create or replace function match_transfer_counterparts()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_line record;
begin
  for v_line in
    select jl.account_id, jl.debit - jl.credit as amount
      from journal_lines jl
     where jl.journal_entry_id = new.journal_entry_id and jl.account_id <> new.account_id
  loop
    update bank_transactions
       set status = 'matched', journal_entry_id = new.journal_entry_id
     where id = (
       select b.id from bank_transactions b
        where b.organization_id = new.organization_id
          and b.account_id = v_line.account_id
          and b.status = 'unreconciled'
          and b.amount = v_line.amount
          and abs(b.date - new.date) <= 5
          and not exists (select 1 from bank_transactions o
                           where o.journal_entry_id = new.journal_entry_id and o.account_id = v_line.account_id)
        order by abs(b.date - new.date), b.id
        limit 1
     );
  end loop;
  return null;
end;
$$;

create trigger trg_match_transfer_counterparts
  after update of status, journal_entry_id on bank_transactions
  for each row
  when (new.status = 'matched' and new.journal_entry_id is not null
        and (old.status <> 'matched' or old.journal_entry_id is distinct from new.journal_entry_id))
  execute function match_transfer_counterparts();

create index idx_bank_transactions_unreconciled
  on bank_transactions (organization_id, account_id, amount)
  where status = 'unreconciled';

-- ----------------------------------------------------------------------------
-- 4. Account type changes
-- ----------------------------------------------------------------------------

create or replace function guard_account_type_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type is distinct from old.type
     and exists (select 1 from journal_lines where account_id = old.id) then
    raise exception 'An account with transactions can''t change type; create a new account and move them instead';
  end if;
  return new;
end;
$$;

create trigger trg_guard_account_type_change
  before update of type on accounts
  for each row execute function guard_account_type_change();

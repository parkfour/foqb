-- ============================================================================
-- Plaid can report a change to a transaction that's already matched to a
-- posted entry. Applying it silently would make the entry disagree with the
-- bank, or change a payment/reconciliation behind the user's back — so the
-- bank's new values are held in bank_change ({"amount": ..., "date": ...})
-- for review instead, and the Bank Feed flags the row.
--
-- reopen_blocker(bank_transactions): why this row can't be re-opened
-- automatically, or null if it can. Exposed to PostgREST as a computed
-- column (select=...,reopen_blocker) so the UI and reopen_bank_transaction
-- apply exactly the same rule.
--
-- reopen_bank_transaction: voids the bank-feed entry and puts the
-- transaction back to unreconciled with the bank's new amount/date, all in
-- one transaction, so it can be categorized again normally.
--
-- SECURITY INVOKER: RLS applies as for the equivalent direct writes.
-- ============================================================================

alter table bank_transactions add column bank_change jsonb;

create or replace function reopen_blocker(bt bank_transactions)
returns text
language sql
stable
set search_path = public
as $$
  select case
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

  if not found or v_bt.status <> 'matched' or v_bt.bank_change is null then
    raise exception 'That bank transaction has no bank change to apply';
  end if;

  v_blocker := reopen_blocker(v_bt);
  if v_blocker is not null then
    raise exception '%', v_blocker;
  end if;

  update journal_entries set status = 'void' where id = v_bt.journal_entry_id;

  update bank_transactions
     set status = 'unreconciled',
         journal_entry_id = null,
         amount = (v_bt.bank_change->>'amount')::numeric,
         date = (v_bt.bank_change->>'date')::date,
         bank_change = null
   where id = v_bt.id;
end;
$$;

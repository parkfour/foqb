-- ============================================================================
-- Voiding an invoice or bill that has payments: its own entry and every
-- payment's entry are voided, the payments are removed, and the bank
-- transactions they were matched to go back to the feed to be booked
-- again. A credit memo's application is simply undone; the memo stays, as
-- credit the customer holds. Refused when any of those entries is in a
-- bank reconciliation or a locked period: those need a person to look.
-- Runs as the definer (payments have no delete policy), so it checks the
-- caller is one of the book's writers itself.
-- ============================================================================

create or replace function void_document_blocker(p_org_id uuid, p_entry_ids uuid[])
returns text
language sql
stable
set search_path = public
as $$
  select case
    when exists (
      select 1 from journal_lines
       where journal_entry_id = any (p_entry_ids) and reconciliation_id is not null
    ) then 'A payment on it is part of a bank reconciliation. Undo the reconciliation first.'
    when exists (
      select 1 from journal_entries je join organizations o on o.id = je.organization_id
       where je.id = any (p_entry_ids) and o.id = p_org_id
         and o.period_lock_date is not null and je.entry_date <= o.period_lock_date
    ) then 'It or a payment on it is in a locked period.'
  end;
$$;
revoke execute on function void_document_blocker(uuid, uuid[]) from public, anon, authenticated;

create or replace function void_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_cash_entries uuid[];
  v_blocker text;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found or not is_org_writer(v_invoice.organization_id) then
    raise exception 'Invoice not found';
  end if;
  if v_invoice.status = 'void' then
    raise exception 'This invoice is already void';
  end if;

  -- A credit memo's entry is the memo's own and stays posted.
  select coalesce(array_agg(journal_entry_id), '{}') into v_cash_entries
    from invoice_payments
   where invoice_id = p_invoice_id and credit_memo_id is null and journal_entry_id is not null;

  v_blocker := void_document_blocker(v_invoice.organization_id, v_cash_entries || v_invoice.journal_entry_id);
  if v_blocker is not null then
    raise exception '%', v_blocker;
  end if;

  update bank_transactions
     set status = 'unreconciled', journal_entry_id = null
   where organization_id = v_invoice.organization_id and journal_entry_id = any (v_cash_entries);
  delete from invoice_payments where invoice_id = p_invoice_id;
  update journal_entries set status = 'void'
   where id = any (v_cash_entries || v_invoice.journal_entry_id) and status = 'posted';
  update invoices set status = 'void' where id = p_invoice_id;
end;
$$;
revoke execute on function void_invoice(uuid) from public, anon;

create or replace function void_bill(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill bills%rowtype;
  v_cash_entries uuid[];
  v_blocker text;
begin
  select * into v_bill from bills where id = p_bill_id for update;
  if not found or not is_org_writer(v_bill.organization_id) then
    raise exception 'Bill not found';
  end if;
  if v_bill.status = 'void' then
    raise exception 'This bill is already void';
  end if;

  select coalesce(array_agg(journal_entry_id), '{}') into v_cash_entries
    from bill_payments
   where bill_id = p_bill_id and journal_entry_id is not null;

  v_blocker := void_document_blocker(v_bill.organization_id, v_cash_entries || v_bill.journal_entry_id);
  if v_blocker is not null then
    raise exception '%', v_blocker;
  end if;

  update bank_transactions
     set status = 'unreconciled', journal_entry_id = null
   where organization_id = v_bill.organization_id and journal_entry_id = any (v_cash_entries);
  delete from bill_payments where bill_id = p_bill_id;
  update journal_entries set status = 'void'
   where id = any (v_cash_entries || v_bill.journal_entry_id) and status = 'posted';
  update bills set status = 'void' where id = p_bill_id;
end;
$$;
revoke execute on function void_bill(uuid) from public, anon;

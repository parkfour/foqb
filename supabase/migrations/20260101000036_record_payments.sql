-- ============================================================================
-- Records an invoice/bill payment in one transaction, serialized per
-- invoice/bill.
--
-- The payment routes read the remaining balance and the bank transaction's
-- status, then wrote the entry, the payment and the bank transaction match
-- as separate requests — so two submissions at once could both pass the
-- "remaining balance" check (overpaying) or both match the same bank
-- transaction, and a failure midway left a posted entry behind. Here the
-- invoice/bill row is locked FOR UPDATE first, so a concurrent payment
-- waits and then sees this one; the entry is posted and the bank
-- transaction claimed via post_journal_entry (claim fails if no longer
-- unreconciled); and any error rolls the whole thing back.
--
-- When p_bank_transaction_id is given, the bank transaction's own amount
-- and account are used — never the client-supplied ones.
-- SECURITY INVOKER: RLS applies as it did to the individual writes.
-- ============================================================================

create or replace function record_invoice_payment(
  p_invoice_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_deposit_account_id uuid,
  p_ar_account_id uuid,
  p_bank_transaction_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_amount numeric := p_amount;
  v_account uuid := p_deposit_account_id;
  v_bank bank_transactions%rowtype;
  v_remaining numeric;
  v_entry_id uuid;
  v_payment_id uuid;
  v_status text;
begin
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if v_invoice.status in ('paid', 'void') then
    raise exception 'Invoice is already %', v_invoice.status;
  end if;

  if p_bank_transaction_id is not null then
    select * into v_bank from bank_transactions
     where id = p_bank_transaction_id and organization_id = v_invoice.organization_id
     for update;
    if not found or v_bank.status <> 'unreconciled' or v_bank.amount <= 0 or v_bank.account_id is null then
      raise exception 'That bank transaction is not an available unreconciled deposit';
    end if;
    v_amount := v_bank.amount;
    v_account := v_bank.account_id;
  end if;

  if v_amount is null or v_amount <= 0 or v_account is null then
    raise exception 'A positive amount and a deposit account are required';
  end if;

  v_remaining := round(
    coalesce((select sum(amount) from invoice_lines where invoice_id = p_invoice_id), 0)
    + coalesce(v_invoice.tax_amount, 0)
    - coalesce((select sum(amount) from invoice_payments where invoice_id = p_invoice_id), 0),
    2
  );
  if v_amount > v_remaining then
    raise exception 'Amount exceeds the remaining balance of %', to_char(v_remaining, 'FM999999999990.00');
  end if;

  v_entry_id := post_journal_entry(
    v_invoice.organization_id,
    p_payment_date,
    'Payment for invoice ' || v_invoice.invoice_number,
    jsonb_build_array(
      jsonb_build_object('account_id', v_account, 'debit', v_amount, 'credit', 0),
      jsonb_build_object('account_id', p_ar_account_id, 'debit', 0, 'credit', v_amount)
    ),
    p_bank_transaction_id
  );

  insert into invoice_payments (organization_id, invoice_id, payment_date, amount, deposit_account_id, bank_transaction_id, journal_entry_id)
  values (v_invoice.organization_id, p_invoice_id, p_payment_date, v_amount, v_account, p_bank_transaction_id, v_entry_id)
  returning id into v_payment_id;

  v_status := case when v_amount >= v_remaining then 'paid' else 'partial' end;
  update invoices set status = v_status where id = p_invoice_id;

  return jsonb_build_object('id', v_payment_id, 'status', v_status);
end;
$$;

create or replace function record_bill_payment(
  p_bill_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_account_id uuid,
  p_ap_account_id uuid,
  p_bank_transaction_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_bill bills%rowtype;
  v_amount numeric := p_amount;
  v_account uuid := p_payment_account_id;
  v_bank bank_transactions%rowtype;
  v_remaining numeric;
  v_entry_id uuid;
  v_payment_id uuid;
  v_status text;
begin
  select * into v_bill from bills where id = p_bill_id for update;
  if not found then
    raise exception 'Bill not found';
  end if;
  if v_bill.status in ('paid', 'void') then
    raise exception 'Bill is already %', v_bill.status;
  end if;

  if p_bank_transaction_id is not null then
    select * into v_bank from bank_transactions
     where id = p_bank_transaction_id and organization_id = v_bill.organization_id
     for update;
    if not found or v_bank.status <> 'unreconciled' or v_bank.amount >= 0 or v_bank.account_id is null then
      raise exception 'That bank transaction is not an available unreconciled withdrawal';
    end if;
    v_amount := abs(v_bank.amount);
    v_account := v_bank.account_id;
  end if;

  if v_amount is null or v_amount <= 0 or v_account is null then
    raise exception 'A positive amount and a payment account are required';
  end if;

  v_remaining := round(
    coalesce((select sum(amount) from bill_lines where bill_id = p_bill_id), 0)
    - coalesce((select sum(amount) from bill_payments where bill_id = p_bill_id), 0),
    2
  );
  if v_amount > v_remaining then
    raise exception 'Amount exceeds the remaining balance of %', to_char(v_remaining, 'FM999999999990.00');
  end if;

  v_entry_id := post_journal_entry(
    v_bill.organization_id,
    p_payment_date,
    'Payment for bill ' || v_bill.bill_number,
    jsonb_build_array(
      jsonb_build_object('account_id', p_ap_account_id, 'debit', v_amount, 'credit', 0),
      jsonb_build_object('account_id', v_account, 'debit', 0, 'credit', v_amount)
    ),
    p_bank_transaction_id
  );

  insert into bill_payments (organization_id, bill_id, payment_date, amount, payment_account_id, bank_transaction_id, journal_entry_id)
  values (v_bill.organization_id, p_bill_id, p_payment_date, v_amount, v_account, p_bank_transaction_id, v_entry_id)
  returning id into v_payment_id;

  v_status := case when v_amount >= v_remaining then 'paid' else 'partial' end;
  update bills set status = v_status where id = p_bill_id;

  return jsonb_build_object('id', v_payment_id, 'status', v_status);
end;
$$;

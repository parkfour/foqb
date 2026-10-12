-- ============================================================================
-- Every foreign key between org-scoped tables must stay inside one org.
--
-- RLS only checks the row being written (e.g. a journal line's parent
-- entry), not what its foreign keys point at — so a writer in org A could
-- post a journal line against org B's account, and the SECURITY DEFINER
-- paths (restore_organization, the Plaid webhook's service-role client)
-- skip RLS entirely. A trigger applies to every caller.
--
-- enforce_same_org(owner, [column, referenced_table]...):
--   owner = 'self'              -> NEW.organization_id
--           'id'                -> NEW.id (the organizations table itself)
--           'table.column'      -> organization_id of the parent row
-- SECURITY DEFINER so the lookups see rows RLS would hide from the caller
-- (a hidden row must still be rejected, not read as "no org").
-- ============================================================================

create or replace function enforce_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_org uuid;
  v_ref_org uuid;
  v_parent text[];
  i int := 1;
begin
  if tg_argv[0] = 'self' then
    v_org := (v_row->>'organization_id')::uuid;
  elsif tg_argv[0] = 'id' then
    v_org := (v_row->>'id')::uuid;
  else
    v_parent := string_to_array(tg_argv[0], '.');
    execute format('select organization_id from %I where id = $1', v_parent[1])
      into v_org using (v_row->>v_parent[2])::uuid;
  end if;

  while i < tg_nargs loop
    if v_row->>tg_argv[i] is not null then
      execute format('select organization_id from %I where id = $1', tg_argv[i + 1])
        into v_ref_org using (v_row->>tg_argv[i])::uuid;

      if v_ref_org is distinct from v_org then
        raise exception '%.% must reference a row in the same organization', tg_table_name, tg_argv[i];
      end if;
    end if;
    i := i + 2;
  end loop;

  return new;
end;
$$;

create trigger trg_same_org before insert or update of ar_account_id, ap_account_id, tax_payable_account_id
  on organizations for each row
  execute function enforce_same_org('id', 'ar_account_id', 'accounts', 'ap_account_id', 'accounts', 'tax_payable_account_id', 'accounts');

create trigger trg_same_org before insert or update of organization_id, account_id
  on bank_reconciliations for each row
  execute function enforce_same_org('self', 'account_id', 'accounts');

create trigger trg_same_org before insert or update of journal_entry_id, account_id, reconciliation_id
  on journal_lines for each row
  execute function enforce_same_org('journal_entries.journal_entry_id', 'account_id', 'accounts', 'reconciliation_id', 'bank_reconciliations');

create trigger trg_same_org before insert or update of organization_id, account_id, journal_entry_id
  on bank_transactions for each row
  execute function enforce_same_org('self', 'account_id', 'accounts', 'journal_entry_id', 'journal_entries');

create trigger trg_same_org before insert or update of organization_id, target_account_id
  on categorization_rules for each row
  execute function enforce_same_org('self', 'target_account_id', 'accounts');

create trigger trg_same_org before insert or update of organization_id, customer_id, journal_entry_id
  on invoices for each row
  execute function enforce_same_org('self', 'customer_id', 'customers', 'journal_entry_id', 'journal_entries');

create trigger trg_same_org before insert or update of invoice_id, account_id, item_id
  on invoice_lines for each row
  execute function enforce_same_org('invoices.invoice_id', 'account_id', 'accounts', 'item_id', 'items');

create trigger trg_same_org before insert or update of organization_id, invoice_id, deposit_account_id, journal_entry_id, bank_transaction_id
  on invoice_payments for each row
  execute function enforce_same_org('self', 'invoice_id', 'invoices', 'deposit_account_id', 'accounts', 'journal_entry_id', 'journal_entries', 'bank_transaction_id', 'bank_transactions');

create trigger trg_same_org before insert or update of organization_id, vendor_id, journal_entry_id
  on bills for each row
  execute function enforce_same_org('self', 'vendor_id', 'vendors', 'journal_entry_id', 'journal_entries');

create trigger trg_same_org before insert or update of bill_id, account_id
  on bill_lines for each row
  execute function enforce_same_org('bills.bill_id', 'account_id', 'accounts');

create trigger trg_same_org before insert or update of organization_id, bill_id, payment_account_id, journal_entry_id, bank_transaction_id
  on bill_payments for each row
  execute function enforce_same_org('self', 'bill_id', 'bills', 'payment_account_id', 'accounts', 'journal_entry_id', 'journal_entries', 'bank_transaction_id', 'bank_transactions');

create trigger trg_same_org before insert or update of organization_id, asset_account_id
  on inventory_items for each row
  execute function enforce_same_org('self', 'asset_account_id', 'accounts');

create trigger trg_same_org before insert or update of organization_id, income_account_id
  on items for each row
  execute function enforce_same_org('self', 'income_account_id', 'accounts');

create trigger trg_same_org before insert or update of organization_id, customer_id
  on recurring_invoices for each row
  execute function enforce_same_org('self', 'customer_id', 'customers');

create trigger trg_same_org before insert or update of recurring_invoice_id, item_id, account_id
  on recurring_invoice_lines for each row
  execute function enforce_same_org('recurring_invoices.recurring_invoice_id', 'item_id', 'items', 'account_id', 'accounts');

create trigger trg_same_org before insert or update of organization_id, vendor_id
  on recurring_bills for each row
  execute function enforce_same_org('self', 'vendor_id', 'vendors');

create trigger trg_same_org before insert or update of recurring_bill_id, account_id
  on recurring_bill_lines for each row
  execute function enforce_same_org('recurring_bills.recurring_bill_id', 'account_id', 'accounts');

create trigger trg_same_org before insert or update of organization_id, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id
  on fixed_assets for each row
  execute function enforce_same_org('self', 'asset_account_id', 'accounts', 'accumulated_depreciation_account_id', 'accounts', 'depreciation_expense_account_id', 'accounts');

-- ============================================================================
-- Where an entry came from, for entries brought in from outside (a CSV
-- import, later a point-of-sale feed): the source and its own id for the
-- entry. One entry per (book, source, id), so bringing the same thing in
-- twice books it once.
-- ============================================================================

alter table journal_entries
  add column source text check (source is null or length(source) between 1 and 100),
  add column external_id text check (external_id is null or length(external_id) between 1 and 200),
  add constraint journal_entries_external_needs_source check (external_id is null or source is not null);

create unique index journal_entries_source_external_key
  on journal_entries (organization_id, source, external_id)
  where external_id is not null;

-- restore_organization as of 20260101000080, with each entry's source and
-- external id.
create or replace function restore_organization(p_snapshot jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to restore a backup';
  end if;

  v_org_id := (p_snapshot->'organization'->>'id')::uuid;
  if v_org_id is null then
    raise exception 'This backup file is missing its organization id';
  end if;

  -- coalesce() on the not-null-with-a-default columns: a hand-edited or
  -- truncated upload might omit one of these, and falling back to the
  -- schema's own default is safer than a raw not-null-constraint error.
  insert into organizations (id, name, status, period_lock_date, inventory_enabled, use_account_codes, tax_form, default_tax_rate, workspace_type, timezone, currency, created_at)
  select id, name, 'active', null, coalesce(inventory_enabled, false),
    coalesce(use_account_codes, true), coalesce(tax_form, 'none'), default_tax_rate, coalesce(workspace_type, 'business'), timezone, coalesce(currency, 'USD'), coalesce(created_at, now())
  from jsonb_to_recordset(jsonb_build_array(p_snapshot->'organization')) as x(
    id uuid, name text, period_lock_date date, inventory_enabled boolean,
    use_account_codes boolean, tax_form varchar, default_tax_rate numeric, workspace_type text, timezone text, currency text, created_at timestamptz
  );

  insert into organization_members (organization_id, user_id, role)
  values (v_org_id, auth.uid(), 'owner');

  insert into accounts (id, organization_id, account_number, name, type, description, is_active, tax_line_id, external_account_id, budget_rollover)
  select id, v_org_id, account_number, name, type, description, is_active, tax_line_id, external_account_id, coalesce(budget_rollover, false)
  from jsonb_to_recordset(coalesce(p_snapshot->'accounts', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, account_number varchar, name varchar, type account_type,
    description text, is_active boolean, tax_line_id uuid, external_account_id text, budget_rollover boolean
  );

  update organizations o
    set ar_account_id = (p_snapshot->'organization'->>'ar_account_id')::uuid,
        ap_account_id = (p_snapshot->'organization'->>'ap_account_id')::uuid,
        tax_payable_account_id = (p_snapshot->'organization'->>'tax_payable_account_id')::uuid
    where o.id = v_org_id;

  insert into bank_reconciliations (id, organization_id, account_id, statement_date, statement_ending_balance, status, created_by, created_at, completed_at)
  select id, v_org_id, account_id, statement_date, statement_ending_balance, status, created_by, coalesce(created_at, now()), completed_at
  from jsonb_to_recordset(coalesce(p_snapshot->'bank_reconciliations', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, account_id uuid, statement_date date, statement_ending_balance numeric,
    status varchar, created_by uuid, created_at timestamptz, completed_at timestamptz
  );

  insert into sales_tax_rates (id, organization_id, name, rate, account_id, is_active, created_at)
  select id, v_org_id, name, rate, account_id, coalesce(is_active, true), coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'sales_tax_rates', '[]'::jsonb)) as x(
    id uuid, name varchar, rate numeric, account_id uuid, is_active boolean, created_at timestamptz
  );

  insert into customers (id, organization_id, name, email, phone, billing_address, is_active, created_at)
  select id, v_org_id, name, email, phone, billing_address, is_active, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'customers', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, name varchar, email varchar, phone varchar,
    billing_address text, is_active boolean, created_at timestamptz
  );

  insert into vendors (id, organization_id, name, email, phone, address, is_active, is_1099, created_at)
  select id, v_org_id, name, email, phone, address, is_active, coalesce(is_1099, false), coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'vendors', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, name varchar, email varchar, phone varchar,
    address text, is_active boolean, is_1099 boolean, created_at timestamptz
  );

  insert into items (id, organization_id, name, description, income_account_id, sale_price, track_quantity, quantity_on_hand, is_active, created_at)
  select id, v_org_id, name, description, income_account_id, sale_price, track_quantity, quantity_on_hand, is_active, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'items', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, name varchar, description text, income_account_id uuid,
    sale_price numeric, track_quantity boolean, quantity_on_hand numeric, is_active boolean, created_at timestamptz
  );

  insert into inventory_items (id, organization_id, sku, name, quantity_on_hand, unit_cost, asset_account_id, is_active, created_at)
  select id, v_org_id, sku, name, quantity_on_hand, unit_cost, asset_account_id, is_active, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'inventory_items', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, sku varchar, name varchar, quantity_on_hand numeric,
    unit_cost numeric, asset_account_id uuid, is_active boolean, created_at timestamptz
  );

  insert into fixed_assets (id, organization_id, name, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id, purchase_date, cost, salvage_value, useful_life_months, accumulated_months, next_depreciation_date, is_active, created_at)
  select id, v_org_id, name, asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id, purchase_date, cost, salvage_value, useful_life_months, accumulated_months, next_depreciation_date, is_active, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'fixed_assets', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, name text, asset_account_id uuid, accumulated_depreciation_account_id uuid,
    depreciation_expense_account_id uuid, purchase_date date, cost numeric, salvage_value numeric,
    useful_life_months int, accumulated_months int, next_depreciation_date date, is_active boolean, created_at timestamptz
  );

  -- As drafts first, so their lines can be added (lines of a posted entry
  -- can't be); each gets its saved status once its lines are in.
  insert into journal_entries (id, organization_id, entry_date, memo, status, created_by, created_at, source, external_id)
  select id, v_org_id, entry_date, memo, 'draft', created_by, coalesce(created_at, now()), source, external_id
  from jsonb_to_recordset(coalesce(p_snapshot->'journal_entries', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, entry_date date, memo text, status varchar, created_by uuid, created_at timestamptz,
    source text, external_id text
  );

  insert into journal_lines (id, journal_entry_id, account_id, description, debit, credit, reconciliation_id, cleared)
  select x.id, (je.entry->>'id')::uuid, x.account_id, x.description, x.debit, x.credit, x.reconciliation_id, coalesce(x.cleared, false)
  from jsonb_array_elements(coalesce(p_snapshot->'journal_entries', '[]'::jsonb)) as je(entry),
       jsonb_to_recordset(coalesce(je.entry->'journal_lines', '[]'::jsonb)) as x(
         id uuid, journal_entry_id uuid, account_id uuid, description text,
         debit numeric, credit numeric, reconciliation_id uuid, cleared boolean
       );

  -- Now the saved status (the balance check runs on posting).
  update journal_entries je set status = x.status
  from jsonb_to_recordset(coalesce(p_snapshot->'journal_entries', '[]'::jsonb)) as x(id uuid, status varchar)
  where je.id = x.id and je.organization_id = v_org_id and x.status is distinct from 'draft';

  insert into bank_transactions (id, organization_id, account_id, external_transaction_id, external_account_id, date, name, amount, status, journal_entry_id, cleared)
  select id, v_org_id, account_id, external_transaction_id, external_account_id, date, name, amount, status, journal_entry_id, coalesce(cleared, false)
  from jsonb_to_recordset(coalesce(p_snapshot->'bank_transactions', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, account_id uuid, external_transaction_id varchar, external_account_id varchar,
    date date, name varchar, amount numeric, status varchar, journal_entry_id uuid, cleared boolean
  );

  insert into invoices (id, organization_id, customer_id, invoice_number, invoice_date, due_date, status, journal_entry_id, created_at, tax_rate, tax_amount)
  select id, v_org_id, customer_id, invoice_number, invoice_date, due_date, status, journal_entry_id, coalesce(created_at, now()), tax_rate, tax_amount
  from jsonb_to_recordset(coalesce(p_snapshot->'invoices', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, customer_id uuid, invoice_number varchar, invoice_date date, due_date date,
    status varchar, journal_entry_id uuid, created_at timestamptz, tax_rate numeric, tax_amount numeric
  );

  insert into invoice_lines (id, invoice_id, description, account_id, quantity, unit_price, amount, item_id)
  select x.id, (inv.entry->>'id')::uuid, x.description, x.account_id, x.quantity, x.unit_price, x.amount, x.item_id
  from jsonb_array_elements(coalesce(p_snapshot->'invoices', '[]'::jsonb)) as inv(entry),
       jsonb_to_recordset(coalesce(inv.entry->'invoice_lines', '[]'::jsonb)) as x(
         id uuid, invoice_id uuid, description text, account_id uuid,
         quantity numeric, unit_price numeric, amount numeric, item_id uuid
       );

  insert into invoice_taxes (id, organization_id, invoice_id, tax_rate_id, name, rate, amount, account_id)
  select x.id, v_org_id, (inv.entry->>'id')::uuid, x.tax_rate_id, x.name, x.rate, x.amount, x.account_id
  from jsonb_array_elements(coalesce(p_snapshot->'invoices', '[]'::jsonb)) as inv(entry),
       jsonb_to_recordset(coalesce(inv.entry->'invoice_taxes', '[]'::jsonb)) as x(
         id uuid, tax_rate_id uuid, name varchar, rate numeric, amount numeric, account_id uuid
       );

  insert into bills (id, organization_id, vendor_id, bill_number, bill_date, due_date, status, journal_entry_id, created_at)
  select id, v_org_id, vendor_id, bill_number, bill_date, due_date, status, journal_entry_id, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'bills', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, vendor_id uuid, bill_number varchar, bill_date date, due_date date,
    status varchar, journal_entry_id uuid, created_at timestamptz
  );

  insert into bill_lines (id, bill_id, description, account_id, quantity, unit_price, amount)
  select x.id, (b.entry->>'id')::uuid, x.description, x.account_id, x.quantity, x.unit_price, x.amount
  from jsonb_array_elements(coalesce(p_snapshot->'bills', '[]'::jsonb)) as b(entry),
       jsonb_to_recordset(coalesce(b.entry->'bill_lines', '[]'::jsonb)) as x(
         id uuid, bill_id uuid, description text, account_id uuid,
         quantity numeric, unit_price numeric, amount numeric
       );

  insert into invoice_payments (id, organization_id, invoice_id, payment_date, amount, deposit_account_id, journal_entry_id, created_at, bank_transaction_id)
  select id, v_org_id, invoice_id, payment_date, amount, deposit_account_id, journal_entry_id, coalesce(created_at, now()), bank_transaction_id
  from jsonb_to_recordset(coalesce(p_snapshot->'invoice_payments', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, invoice_id uuid, payment_date date, amount numeric,
    deposit_account_id uuid, journal_entry_id uuid, created_at timestamptz, bank_transaction_id uuid
  );

  insert into bill_payments (id, organization_id, bill_id, payment_date, amount, payment_account_id, journal_entry_id, created_at, bank_transaction_id)
  select id, v_org_id, bill_id, payment_date, amount, payment_account_id, journal_entry_id, coalesce(created_at, now()), bank_transaction_id
  from jsonb_to_recordset(coalesce(p_snapshot->'bill_payments', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, bill_id uuid, payment_date date, amount numeric,
    payment_account_id uuid, journal_entry_id uuid, created_at timestamptz, bank_transaction_id uuid
  );

  insert into recurring_invoices (id, organization_id, customer_id, frequency, next_date, tax_rate, is_active, created_at)
  select id, v_org_id, customer_id, frequency, next_date, tax_rate, is_active, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'recurring_invoices', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, customer_id uuid, frequency recurrence_frequency, next_date date,
    tax_rate numeric, is_active boolean, created_at timestamptz
  );

  insert into recurring_invoice_lines (id, recurring_invoice_id, item_id, account_id, description, quantity, unit_price)
  select x.id, (ri.entry->>'id')::uuid, x.item_id, x.account_id, x.description, x.quantity, x.unit_price
  from jsonb_array_elements(coalesce(p_snapshot->'recurring_invoices', '[]'::jsonb)) as ri(entry),
       jsonb_to_recordset(coalesce(ri.entry->'recurring_invoice_lines', '[]'::jsonb)) as x(
         id uuid, recurring_invoice_id uuid, item_id uuid, account_id uuid,
         description text, quantity numeric, unit_price numeric
       );

  insert into recurring_bills (id, organization_id, vendor_id, frequency, next_date, is_active, created_at)
  select id, v_org_id, vendor_id, frequency, next_date, is_active, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'recurring_bills', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, vendor_id uuid, frequency recurrence_frequency, next_date date,
    is_active boolean, created_at timestamptz
  );

  insert into recurring_bill_lines (id, recurring_bill_id, account_id, description, quantity, unit_price)
  select x.id, (rb.entry->>'id')::uuid, x.account_id, x.description, x.quantity, x.unit_price
  from jsonb_array_elements(coalesce(p_snapshot->'recurring_bills', '[]'::jsonb)) as rb(entry),
       jsonb_to_recordset(coalesce(rb.entry->'recurring_bill_lines', '[]'::jsonb)) as x(
         id uuid, recurring_bill_id uuid, account_id uuid, description text, quantity numeric, unit_price numeric
       );

  insert into categorization_rules (id, organization_id, target_account_id, bank_account_id, rule_name, match_type, match_text, transaction_type, min_amount, max_amount, priority, is_active, created_at)
  select id, v_org_id, target_account_id, bank_account_id, rule_name, match_type, match_text, transaction_type, min_amount, max_amount, priority, is_active, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'categorization_rules', '[]'::jsonb)) as x(
    id uuid, organization_id uuid, target_account_id uuid, bank_account_id uuid, rule_name varchar, match_type varchar,
    match_text varchar, transaction_type varchar, min_amount numeric, max_amount numeric,
    priority int, is_active boolean, created_at timestamptz
  );

  insert into properties (id, organization_id, name, address_street, address_city, address_state, address_zip, purchase_price, purchase_date, estimated_value, last_valuation_at, created_at)
  select id, v_org_id, name, address_street, address_city, address_state, address_zip, purchase_price, purchase_date, estimated_value, last_valuation_at, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'properties', '[]'::jsonb)) as x(
    id uuid, name text, address_street text, address_city text, address_state text, address_zip text,
    purchase_price numeric, purchase_date date, estimated_value numeric, last_valuation_at timestamptz, created_at timestamptz
  );

  insert into monthly_budgets (id, organization_id, account_id, year_month, budgeted_amount, notes, created_at, updated_at)
  select id, v_org_id, account_id, year_month, budgeted_amount, notes, coalesce(created_at, now()), coalesce(updated_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'monthly_budgets', '[]'::jsonb)) as x(
    id uuid, account_id uuid, year_month text, budgeted_amount numeric, notes text,
    created_at timestamptz, updated_at timestamptz
  );

  insert into net_worth_snapshots (id, organization_id, date, total_assets, total_liabilities, net_worth, breakdown, created_at)
  select id, v_org_id, date, total_assets, total_liabilities, net_worth, breakdown, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'net_worth_snapshots', '[]'::jsonb)) as x(
    id uuid, date date, total_assets numeric, total_liabilities numeric, net_worth numeric,
    breakdown jsonb, created_at timestamptz
  );

  insert into organization_timezone_changes (id, organization_id, changed_at, changed_by, old_timezone, new_timezone, first_affected, last_affected)
  select id, v_org_id, changed_at, null, old_timezone, new_timezone, first_affected, last_affected
  from jsonb_to_recordset(coalesce(p_snapshot->'timezone_changes', '[]'::jsonb)) as x(
    id uuid, changed_at timestamptz, old_timezone text, new_timezone text, first_affected date, last_affected date
  );

  insert into mortgage_notes (id, organization_id, name, borrower_name, borrower_address, lender_name, lender_address, property_address, origination_date, original_principal, annual_rate, term_months, first_payment_date, payment_amount, escrow_amount, match_text, note_account_id, interest_account_id, escrow_account_id, created_at)
  select id, v_org_id, name, borrower_name, borrower_address, lender_name, lender_address, property_address, origination_date, original_principal, annual_rate, term_months, first_payment_date, payment_amount, coalesce(escrow_amount, 0), match_text, note_account_id, interest_account_id, escrow_account_id, coalesce(created_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'mortgage_notes', '[]'::jsonb)) as x(
    id uuid, name text, borrower_name text, borrower_address text, lender_name text, lender_address text,
    property_address text, origination_date date, original_principal numeric, annual_rate numeric, term_months int,
    first_payment_date date, payment_amount numeric, escrow_amount numeric, match_text text,
    note_account_id uuid, interest_account_id uuid, escrow_account_id uuid, created_at timestamptz
  );

  -- Accounts went in before properties: now their properties.
  update accounts a set property_id = x.property_id
  from jsonb_to_recordset(coalesce(p_snapshot->'accounts', '[]'::jsonb)) as x(id uuid, property_id uuid)
  where a.id = x.id and a.organization_id = v_org_id and x.property_id is not null;

  insert into plugin_data (id, organization_id, plugin_id, key, value, updated_at)
  select id, v_org_id, plugin_id, key, value, coalesce(updated_at, now())
  from jsonb_to_recordset(coalesce(p_snapshot->'plugin_data', '[]'::jsonb)) as x(
    id uuid, plugin_id text, key text, value jsonb, updated_at timestamptz
  );

  -- Last: the period lock would refuse the entries above.
  update organizations set period_lock_date = (p_snapshot->'organization'->>'period_lock_date')::date
  where id = v_org_id;

  return v_org_id;
end;
$$;

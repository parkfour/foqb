-- Fills one organization with three months of a sample business (a small
-- coffee roaster): customers and vendors, invoices and bills (some paid,
-- some overdue), retail sales, and a bank feed with matched and
-- unreviewed transactions. Used for the README screenshots and handy for
-- demos. Dates are relative to today.
--
--   psql -v org=<organization id> -f scripts/seed-sample-company.sql
--
-- Run as a database owner (it bypasses row-level security). Expects the
-- organization's starter chart of accounts (1000, 1200, 2000, 3000, 4000,
-- 5000), which every new organization gets.

\set ON_ERROR_STOP on
select set_config('seed.org', :'org', false);

begin;

-- A posted, balanced journal entry. lines: [[account number, debit, credit, description], ...]
create function pg_temp.je(p_date date, p_memo text, p_lines jsonb) returns uuid
language plpgsql as $$
declare
  org uuid := current_setting('seed.org')::uuid;
  entry uuid;
  line jsonb;
begin
  insert into journal_entries (organization_id, entry_date, memo, status)
    values (org, p_date, p_memo, 'draft') returning id into entry;
  for line in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (journal_entry_id, account_id, debit, credit, description)
    select entry, a.id, (line->>1)::numeric, (line->>2)::numeric, line->>3
      from accounts a where a.organization_id = org and a.account_number = line->>0;
  end loop;
  update journal_entries set status = 'posted' where id = entry;
  return entry;
end;
$$;

create function pg_temp.acct(p_number text) returns uuid
language sql as $$
  select id from accounts
   where organization_id = current_setting('seed.org')::uuid and account_number = p_number;
$$;

-- Accounts beyond the starter chart.
insert into accounts (organization_id, account_number, name, type)
select current_setting('seed.org')::uuid, n, name, t::account_type
from (values
  ('1010', 'Business Checking', 'asset'),
  ('1500', 'Roasting Equipment', 'asset'),
  ('4010', 'Retail Sales', 'revenue'),
  ('4020', 'Wholesale Sales', 'revenue'),
  ('5010', 'Green Coffee', 'expense'),
  ('5020', 'Rent', 'expense'),
  ('5030', 'Packaging', 'expense'),
  ('5040', 'Utilities', 'expense'),
  ('5050', 'Software & Subscriptions', 'expense')
) as v(n, name, t);

insert into customers (organization_id, name, email, phone)
select current_setting('seed.org')::uuid, name, email, phone from (values
  ('Bluebird Café', 'orders@bluebird.example', '555-0141'),
  ('Harbor Street Bakery', 'hello@harborbakery.example', '555-0177'),
  ('The Daily Grind', 'manager@dailygrind.example', '555-0102'),
  ('Northside Co-op', 'purchasing@northside.example', '555-0190')
) as v(name, email, phone);

insert into vendors (organization_id, name, email, address)
select current_setting('seed.org')::uuid, name, email, address from (values
  ('Altura Green Coffee Importers', 'sales@altura.example', '12 Dock Rd, Oakland, CA'),
  ('Millbrook Properties', 'leasing@millbrook.example', '400 Main St, Suite 2'),
  ('PackRight Supply', 'orders@packright.example', '88 Industrial Way')
) as v(name, email, address);

-- Opening money and equipment.
select pg_temp.je(current_date - 95, 'Owner investment', '[["1010", 30000, 0, "Opening deposit"], ["3000", 0, 30000, null]]');
select pg_temp.je(current_date - 90, 'Used drum roaster', '[["1500", 12500, 0, "5 kg drum roaster"], ["1010", 0, 12500, null]]');

-- Weekly retail sales deposits.
select pg_temp.je(current_date - d, 'Retail sales, week ending ' || to_char(current_date - d, 'Mon DD'),
  jsonb_build_array(jsonb_build_array('1010', amt, 0, null), jsonb_build_array('4010', 0, amt, null)))
from (values (84, 2140.50), (77, 2388.00), (70, 2015.25), (63, 2602.75), (56, 2471.00), (49, 2833.40),
             (42, 2560.10), (35, 2911.80), (28, 2745.35), (21, 3020.90), (14, 2887.60), (7, 3154.25)) as v(d, amt);

-- Monthly rent and utilities, paid straight from checking.
select pg_temp.je(current_date - d, 'Rent', '[["5020", 2400, 0, null], ["1010", 0, 2400, null]]')
from (values (88), (58), (28)) as v(d);
select pg_temp.je(current_date - d, 'Utilities', jsonb_build_array(jsonb_build_array('5040', amt, 0, null), jsonb_build_array('1010', 0, amt, null)))
from (values (80, 412.18), (50, 389.62), (20, 455.03)) as v(d, amt);
select pg_temp.je(current_date - 15, 'Accounting software', '[["5050", 49, 0, null], ["1010", 0, 49, null]]');

-- Wholesale invoices: posted to A/R, some paid.
do $$
declare
  org uuid := current_setting('seed.org')::uuid;
  r record;
  inv uuid;
  entry uuid;
begin
  for r in select * from (values
    ('INV-1001', 'Bluebird Café',        80, 30, 40, 18.50, 1, 'paid'),
    ('INV-1002', 'Harbor Street Bakery', 72, 30, 25, 18.50, 0.5, 'partial'),
    ('INV-1003', 'The Daily Grind',      60, 30, 60, 17.75, 1, 'paid'),
    ('INV-1004', 'Northside Co-op',      45, 30, 30, 19.00, 0, 'open'),
    ('INV-1005', 'Bluebird Café',        25, 30, 45, 18.50, 0, 'open'),
    ('INV-1006', 'The Daily Grind',       6, 30, 55, 17.75, 0, 'open')
  ) as v(num, customer, days_ago, terms, lbs, price, paid_fraction, status) loop
    entry := pg_temp.je(current_date - r.days_ago, 'Invoice ' || r.num,
      jsonb_build_array(jsonb_build_array('1200', r.lbs * r.price, 0, null),
                        jsonb_build_array('4020', 0, r.lbs * r.price, null)));
    insert into invoices (organization_id, customer_id, invoice_number, invoice_date, due_date, status, journal_entry_id)
      select org, c.id, r.num, current_date - r.days_ago, current_date - r.days_ago + r.terms, r.status, entry
        from customers c where c.organization_id = org and c.name = r.customer
      returning id into inv;
    insert into invoice_lines (invoice_id, description, account_id, quantity, unit_price, amount)
      values (inv, 'House espresso blend, whole bean (lb)', pg_temp.acct('4020'), r.lbs, r.price, r.lbs * r.price);
    if r.paid_fraction > 0 then
      entry := pg_temp.je(current_date - r.days_ago + 21, 'Payment for ' || r.num,
        jsonb_build_array(jsonb_build_array('1010', round(r.lbs * r.price * r.paid_fraction, 2), 0, null),
                          jsonb_build_array('1200', 0, round(r.lbs * r.price * r.paid_fraction, 2), null)));
      insert into invoice_payments (organization_id, invoice_id, payment_date, amount, deposit_account_id, journal_entry_id)
        values (org, inv, current_date - r.days_ago + 21, round(r.lbs * r.price * r.paid_fraction, 2), pg_temp.acct('1010'), entry);
    end if;
  end loop;
end;
$$;

-- Bills: posted to A/P, some paid.
do $$
declare
  org uuid := current_setting('seed.org')::uuid;
  r record;
  b uuid;
  entry uuid;
begin
  for r in select * from (values
    ('ALT-2231', 'Altura Green Coffee Importers', 85, 30, '5010', 'Colombia Huila, 2 bags (69 kg)', 1890.00, true),
    ('PR-0912',  'PackRight Supply',              62, 30, '5030', 'Valve bags, 12 oz, case of 500', 640.00, true),
    ('ALT-2290', 'Altura Green Coffee Importers', 40, 30, '5010', 'Ethiopia Yirgacheffe, 2 bags (120 kg)', 2475.00, false),
    ('PR-0977',  'PackRight Supply',              12, 30, '5030', 'Labels and kraft boxes', 318.40, false)
  ) as v(num, vendor, days_ago, terms, account, description, amount, paid) loop
    entry := pg_temp.je(current_date - r.days_ago, 'Bill ' || r.num,
      jsonb_build_array(jsonb_build_array(r.account, r.amount, 0, r.description),
                        jsonb_build_array('2000', 0, r.amount, null)));
    insert into bills (organization_id, vendor_id, bill_number, bill_date, due_date, status, journal_entry_id)
      select org, v.id, r.num, current_date - r.days_ago, current_date - r.days_ago + r.terms,
             case when r.paid then 'paid' else 'open' end, entry
        from vendors v where v.organization_id = org and v.name = r.vendor
      returning id into b;
    insert into bill_lines (bill_id, description, account_id, quantity, unit_price, amount)
      values (b, r.description, pg_temp.acct(r.account), 1, r.amount, r.amount);
    if r.paid then
      entry := pg_temp.je(current_date - r.days_ago + 25, 'Payment for ' || r.num,
        jsonb_build_array(jsonb_build_array('2000', r.amount, 0, null), jsonb_build_array('1010', 0, r.amount, null)));
      insert into bill_payments (organization_id, bill_id, payment_date, amount, payment_account_id, journal_entry_id)
        values (org, b, current_date - r.days_ago + 25, r.amount, pg_temp.acct('1010'), entry);
    end if;
  end loop;
end;
$$;

-- Bank feed for Business Checking: recent transactions waiting for review
-- (one matches a bill payment already in the books). As the app stores
-- them, positive is money in.
insert into bank_transactions (organization_id, account_id, external_transaction_id, external_account_id, date, name, amount, status)
select current_setting('seed.org')::uuid, pg_temp.acct('1010'), 'sample-' || n, 'sample-checking',
       current_date - d, name, amt, status
from (values
  (1, 13, 'SQUARE DEPOSIT 8841',             2887.60, 'unreconciled'),
  (2, 12, 'ALTURA GREEN COFFEE ACH',        -1890.00, 'unreconciled'),
  (3, 10, 'STARBRIGHT ESPRESSO SVC',         -185.00, 'unreconciled'),
  (4,  9, 'CITY WATER & POWER',              -455.03, 'unreconciled'),
  (5,  8, 'COSTCO WHOLESALE #412',            -96.47, 'unreconciled'),
  (6,  6, 'SQUARE DEPOSIT 8902',             3154.25, 'unreconciled'),
  (7,  5, 'GOOGLE *WORKSPACE',                -14.40, 'unreconciled'),
  (8,  4, 'BLUEBIRD CAFE MOBILE DEP',         740.00, 'unreconciled'),
  (9,  3, 'SHELL OIL 57449',                  -48.12, 'unreconciled'),
  (10, 2, 'UPS STORE 2231',                   -23.80, 'unreconciled')
) as v(n, d, name, amt, status);

commit;

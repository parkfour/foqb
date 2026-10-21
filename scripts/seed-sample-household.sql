-- Fills one household organization with three months of a sample family's
-- finances: paychecks, a mortgage and car loan, card spending, a bank feed
-- with categorized and uncategorized transactions, a house, monthly
-- budgets, and net worth history. The household companion to
-- seed-sample-company.sql, used for the screenshots in docs/HOUSEHOLD.md.
-- Dates are relative to today.
--
--   psql -v org=<household organization id> -f scripts/seed-sample-household.sql
--
-- Run as a database owner (it bypasses row-level security). Expects the
-- starter chart of accounts every new organization gets (3000 is used for
-- opening balances).

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

-- A two-line entry: debit one account, credit another.
create function pg_temp.pay(p_date date, p_memo text, p_debit text, p_credit text, p_amount numeric) returns uuid
language sql as $$
  select pg_temp.je(p_date, p_memo, jsonb_build_array(
    jsonb_build_array(p_debit, p_amount, 0, null), jsonb_build_array(p_credit, 0, p_amount, null)));
$$;

create function pg_temp.acct(p_number text) returns uuid
language sql as $$
  select id from accounts
   where organization_id = current_setting('seed.org')::uuid and account_number = p_number;
$$;

-- Names matter: net worth sorts accounts into cash, investments, vehicles,
-- cards, mortgages and loans by name (docs/HOUSEHOLD.md).
insert into accounts (organization_id, account_number, name, type)
select current_setting('seed.org')::uuid, n, name, t::account_type
from (values
  ('1010', 'Joint Checking', 'asset'),
  ('1020', 'High-Yield Savings', 'asset'),
  ('1500', 'Roth IRA', 'asset'),
  ('1510', '401(k)', 'asset'),
  ('1600', '2021 Honda Odyssey', 'asset'),
  ('2100', 'Visa Credit Card', 'liability'),
  ('2200', 'Home Mortgage', 'liability'),
  ('2300', 'Auto Loan', 'liability'),
  ('4010', 'Salary - Alex', 'revenue'),
  ('4020', 'Salary - Sam', 'revenue'),
  ('6010', 'Groceries', 'expense'),
  ('6020', 'Dining Out', 'expense'),
  ('6030', 'Utilities', 'expense'),
  ('6040', 'Gas & Auto', 'expense'),
  ('6050', 'Household Supplies', 'expense'),
  ('6060', 'Kids & Activities', 'expense'),
  ('6070', 'Subscriptions', 'expense'),
  ('6080', 'Mortgage Interest', 'expense'),
  ('6090', 'Insurance', 'expense'),
  ('6100', 'Loan Interest', 'expense')
) as v(n, name, t);

select pg_temp.je(current_date - 95, 'Opening balances', '[
  ["1010", 6800, 0, null], ["1020", 18500, 0, null], ["1500", 41200, 0, null],
  ["1510", 128600, 0, null], ["1600", 27500, 0, null],
  ["2100", 0, 1240, null], ["2200", 0, 268400, null], ["2300", 0, 14900, null],
  ["3000", 61940, 0, "Opening balance equity"]]');

-- Income: Alex every other Friday-ish, Sam monthly, and 401(k) contributions.
select pg_temp.pay(current_date - d, 'Paycheck - Alex', '1010', '4010', 3150) from generate_series(92, 22, -14) d;
select pg_temp.pay(current_date - d, 'Paycheck - Sam', '1010', '4020', 4200) from generate_series(77, 17, -30) d;
select pg_temp.pay(current_date - d, '401(k) contribution', '1510', '4010', 650) from generate_series(77, 17, -30) d;

-- Monthly bills from checking.
select pg_temp.je(current_date - d, 'Mortgage payment',
  '[["2200", 612, 0, "Principal"], ["6080", 1528, 0, "Interest"], ["1010", 0, 2140, null]]') from generate_series(77, 17, -30) d;
select pg_temp.je(current_date - d, 'Auto loan payment',
  '[["2300", 366, 0, "Principal"], ["6100", 46, 0, "Interest"], ["1010", 0, 412, null]]') from generate_series(72, 12, -30) d;
select pg_temp.pay(current_date - d, 'City Power & Water', '6030', '1010', amt)
  from (values (80, 231.40), (50, 248.15)) as v(d, amt);
select pg_temp.pay(current_date - d, 'Car & home insurance', '6090', '1010', 186) from generate_series(78, 48, -30) d;
select pg_temp.pay(current_date - d, 'Transfer to savings', '1020', '1010', 500) from generate_series(76, 16, -30) d;

-- Card spending (on the Visa), paid off monthly from checking.
select pg_temp.pay(current_date - d, 'Groceries', '6010', '2100', 165 + (d * 7) % 70) from generate_series(90, 22, -7) d;
select pg_temp.pay(current_date - d, 'Gas', '6040', '2100', 44 + (d * 3) % 18) from generate_series(89, 22, -8) d;
select pg_temp.pay(current_date - d, 'Dining out', '6020', '2100', 38 + (d * 11) % 55) from generate_series(87, 22, -5) d;
select pg_temp.pay(current_date - d, 'Household supplies', '6050', '2100', 30 + (d * 5) % 45) from generate_series(84, 24, -15) d;
select pg_temp.pay(current_date - d, 'Soccer & piano', '6060', '2100', 225) from generate_series(81, 21, -30) d;
select pg_temp.pay(current_date - d, 'Streaming & apps', '6070', '2100', 58.97) from generate_series(79, 19, -30) d;
select pg_temp.pay(current_date - d, 'Visa payment', '2100', '1010', amt)
  from (values (66, 1240.00), (36, 1655.20)) as v(d, amt);

-- The last three weeks arrive through the bank feed: categorized rows were
-- booked (they have an entry), the rest wait in the register. As the app
-- stores them, positive is money in.
create temp table feed (n int, d int, acct text, name text, amt numeric, category text, cleared boolean);
insert into feed values
  (1, 20, '1010', 'CITY POWER & WATER AUTOPAY',  -229.18, '6030', true),
  (2, 18, '1010', 'GEICO INSURANCE',              -186.00, '6090', true),
  (3, 16, '2100', 'WHOLE FOODS #10233',           -187.42, '6010', true),
  (4,  8, '1010', 'ACME CORP PAYROLL',            3150.00, '4010', true),
  (5, 14, '2100', 'SHELL OIL 57449',               -52.31, '6040', true),
  (6, 12, '2100', 'TRADER JOE''S #552',           -143.86, '6010', true),
  (7, 11, '2100', 'NETFLIX.COM',                   -15.49, '6070', false),
  (8,  9, '2100', 'TARGET 00012',                  -96.22, null,   false),
  (9,  8, '2100', 'CHIPOTLE 2210',                 -41.75, '6020', false),
  (10, 6, '1010', 'VENMO PAYMENT',                 -60.00, null,   false),
  (11, 5, '2100', 'COSTCO WHSE #412',             -214.09, null,   false),
  (12, 3, '2100', 'MARIO''S PIZZERIA',             -58.40, null,   false),
  (13, 2, '1010', 'RIVER CITY SOCCER CLUB',       -120.00, null,   false),
  (14, 1, '2100', 'CHEVRON 0091',                  -47.66, null,   false);

insert into bank_transactions
  (organization_id, account_id, external_transaction_id, external_account_id, date, name, amount, status, cleared, journal_entry_id)
select current_setting('seed.org')::uuid, pg_temp.acct(acct), 'sample-household-' || n, 'sample-' || acct,
       current_date - d, name, amt,
       case when category is null then 'unreconciled' else 'matched' end, cleared,
       case
         when category is null then null
         when amt > 0 then pg_temp.pay(current_date - d, name, acct, category, amt)
         else pg_temp.pay(current_date - d, name, category, acct, -amt)
       end
from feed;

-- Off the ledger: the house, valued by hand.
insert into properties (organization_id, name, address_street, address_city, address_state, address_zip,
                        purchase_price, purchase_date, estimated_value, last_valuation_at)
values (current_setting('seed.org')::uuid, 'Our house', '214 Elm Street', 'Springfield', 'IL', '62704',
        289000, date '2019-06-14', 412000, now() - interval '20 days'),
       (current_setting('seed.org')::uuid, 'Lake lot', '9 Shoreline Road', 'Lake Petersburg', 'IL', '62675',
        58000, date '2022-04-02', 71500, now() - interval '75 days');

-- Budgets for this month and the two before.
insert into monthly_budgets (organization_id, account_id, year_month, budgeted_amount)
select current_setting('seed.org')::uuid, pg_temp.acct(n), to_char(current_date - (m || ' months')::interval, 'YYYY-MM'), amt
from (values ('6010', 850), ('6020', 220), ('6030', 250), ('6040', 220), ('6050', 120),
             ('6060', 250), ('6070', 75), ('6080', 1530), ('6090', 190), ('6100', 50)) as b(n, amt),
     generate_series(0, 2) m;

-- Weekly net worth history, from the ledger as it stood each week plus the
-- house. (The app records a point itself each day someone views it.)
insert into net_worth_snapshots (organization_id, date, total_assets, total_liabilities, net_worth, breakdown)
select current_setting('seed.org')::uuid, day,
       cash + investments + vehicles + 483500, cards + mortgages + loans,
       cash + investments + vehicles + 483500 - (cards + mortgages + loans),
       jsonb_build_object('cash', cash, 'investments', investments, 'real_estate', 483500, 'vehicles', vehicles,
                          'credit_cards', cards, 'mortgages', mortgages, 'loans', loans, 'other_liabilities', 0)
from (
  select day,
    sum(bal) filter (where type = 'asset' and name ~* '\m(cash|checking|savings|money market)\M') as cash,
    sum(bal) filter (where type = 'asset' and name ~* '\m(roth|ira|401)') as investments,
    sum(bal) filter (where type = 'asset' and name ~* 'honda') as vehicles,
    sum(-bal) filter (where type = 'liability' and name ~* '\mcredit\M') as cards,
    sum(-bal) filter (where type = 'liability' and name ~* '\mmortgage\M') as mortgages,
    sum(-bal) filter (where type = 'liability' and name ~* '\mloan\M') as loans
  from (
    select day, a.name, a.type::text as type, coalesce(sum(l.debit - l.credit), 0) as bal
    from generate_series(current_date - 91, current_date - 7, interval '7 days') as g(day)
    cross join accounts a
    left join journal_lines l on l.account_id = a.id
      and exists (select 1 from journal_entries e where e.id = l.journal_entry_id and e.entry_date <= g.day and e.status = 'posted')
    where a.organization_id = current_setting('seed.org')::uuid and a.type in ('asset', 'liability')
    group by day, a.name, a.type
  ) balances
  group by day
) totals;

commit;

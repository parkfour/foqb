-- ============================================================================
-- Tax line item report: chart-of-accounts entries can be tagged with a
-- standard tax return line (Schedule C for sole proprietors, or the shared
-- 1120/1120S corporate line structure), so income/expense can be totaled per
-- tax line for a period instead of just per account.
--
-- tax_lines is a fixed, global reference table (not org-scoped) maintained
-- via migrations, not app code — every org reads from the same vocabulary,
-- scoped to whichever form they pick in organizations.tax_form.
-- ============================================================================

create table tax_lines (
  id          uuid primary key default gen_random_uuid(),
  form        varchar(20) not null check (form in ('schedule_c', 'corporate')),
  code        varchar(20) not null,
  label       varchar(100) not null,
  sort_order  integer not null,
  unique (form, code)
);

alter table tax_lines enable row level security;

create policy "Anyone signed in can view tax lines"
  on tax_lines for select
  to authenticated
  using (true);

-- Schedule C (Form 1040) — Parts I and II line references.
insert into tax_lines (form, code, label, sort_order) values
  ('schedule_c', 'line_1',  'Gross receipts or sales',            10),
  ('schedule_c', 'line_6',  'Other income',                       20),
  ('schedule_c', 'line_8',  'Advertising',                        30),
  ('schedule_c', 'line_9',  'Car and truck expenses',              40),
  ('schedule_c', 'line_10', 'Commissions and fees',                50),
  ('schedule_c', 'line_11', 'Contract labor',                      60),
  ('schedule_c', 'line_12', 'Depletion',                           70),
  ('schedule_c', 'line_13', 'Depreciation and section 179',        80),
  ('schedule_c', 'line_14', 'Employee benefit programs',           90),
  ('schedule_c', 'line_15', 'Insurance (other than health)',      100),
  ('schedule_c', 'line_16a','Interest — mortgage',                110),
  ('schedule_c', 'line_16b','Interest — other',                   120),
  ('schedule_c', 'line_17', 'Legal and professional services',    130),
  ('schedule_c', 'line_18', 'Office expense',                     140),
  ('schedule_c', 'line_19', 'Pension and profit-sharing plans',   150),
  ('schedule_c', 'line_20a','Rent or lease — vehicles/equipment', 160),
  ('schedule_c', 'line_20b','Rent or lease — other business property', 170),
  ('schedule_c', 'line_21', 'Repairs and maintenance',            180),
  ('schedule_c', 'line_22', 'Supplies',                           190),
  ('schedule_c', 'line_23', 'Taxes and licenses',                 200),
  ('schedule_c', 'line_24a','Travel',                             210),
  ('schedule_c', 'line_24b','Meals',                              220),
  ('schedule_c', 'line_25', 'Utilities',                          230),
  ('schedule_c', 'line_26', 'Wages',                               240),
  ('schedule_c', 'line_27a','Other expenses',                     250);

-- 1120 / 1120-S corporate returns share the same income/deduction line
-- structure for this purpose, so one vocabulary covers both.
insert into tax_lines (form, code, label, sort_order) values
  ('corporate', 'line_1a', 'Gross receipts or sales',              10),
  ('corporate', 'line_2',  'Cost of goods sold',                   20),
  ('corporate', 'line_10', 'Other income',                         30),
  ('corporate', 'line_12', 'Compensation of officers',             40),
  ('corporate', 'line_13', 'Salaries and wages',                   50),
  ('corporate', 'line_14', 'Repairs and maintenance',               60),
  ('corporate', 'line_15', 'Bad debts',                             70),
  ('corporate', 'line_16', 'Rents',                                 80),
  ('corporate', 'line_17', 'Taxes and licenses',                    90),
  ('corporate', 'line_18', 'Interest expense',                     100),
  ('corporate', 'line_19', 'Depreciation',                         110),
  ('corporate', 'line_20', 'Depletion',                            120),
  ('corporate', 'line_21', 'Advertising',                          130),
  ('corporate', 'line_23', 'Pension and profit-sharing plans',     140),
  ('corporate', 'line_24', 'Employee benefit programs',            150),
  ('corporate', 'line_26', 'Other deductions',                     160);

alter table organizations
  add column tax_form varchar(20) not null default 'none'
    check (tax_form in ('none', 'schedule_c', 'corporate'));

alter table accounts
  add column tax_line_id uuid references tax_lines (id) on delete set null;

create index idx_accounts_tax_line on accounts (tax_line_id);

-- Tax line report: income/expense totals for a period, grouped by tax line.
-- Accounts with no tax_line_id assigned are rolled into a synthetic
-- "Unassigned" row per type (tax_line_id null) instead of silently dropped,
-- so gaps in tagging are visible rather than hidden.
create or replace function get_tax_line_report(p_org_id uuid, p_start_date date, p_end_date date)
returns table (
  tax_line_id  uuid,
  form         varchar,
  code         varchar,
  label        varchar,
  sort_order   integer,
  account_type account_type,
  amount       numeric
)
language sql
stable
as $$
  with activity as (
    select
      a.tax_line_id,
      a.type,
      case
        when a.type = 'revenue' then coalesce(t.total_credit, 0) - coalesce(t.total_debit, 0)
        else coalesce(t.total_debit, 0) - coalesce(t.total_credit, 0)
      end as amount
    from accounts a
    left join (
      select jl.account_id, sum(jl.debit) as total_debit, sum(jl.credit) as total_credit
      from journal_lines jl
      join journal_entries je
        on je.id = jl.journal_entry_id
       and je.status = 'posted'
       and je.entry_date between p_start_date and p_end_date
      group by jl.account_id
    ) t on t.account_id = a.id
    where a.organization_id = p_org_id
      and a.type in ('revenue', 'expense')
  )
  select
    tl.id as tax_line_id,
    tl.form,
    tl.code,
    tl.label,
    tl.sort_order,
    act.type as account_type,
    sum(act.amount) as amount
  from activity act
  join tax_lines tl on tl.id = act.tax_line_id
  group by tl.id, tl.form, tl.code, tl.label, tl.sort_order, act.type
  union all
  select
    null::uuid as tax_line_id,
    null::varchar as form,
    null::varchar as code,
    ('Unassigned ' || initcap(act.type::text))::varchar as label,
    999999 as sort_order,
    act.type as account_type,
    sum(act.amount) as amount
  from activity act
  where act.tax_line_id is null
  group by act.type
  order by sort_order, label;
$$;

-- Accounts feeding a single tax line (or the "Unassigned" bucket for one
-- type when p_tax_line_id is null) for a period — the tax line report's
-- drill-down.
create or replace function get_tax_line_accounts(
  p_org_id uuid,
  p_tax_line_id uuid,
  p_type account_type,
  p_start_date date,
  p_end_date date
)
returns table (
  account_id      uuid,
  account_number  varchar,
  name            varchar,
  type            account_type,
  amount          numeric
)
language sql
stable
as $$
  select
    a.id as account_id,
    a.account_number,
    a.name,
    a.type,
    case
      when a.type = 'revenue' then coalesce(t.total_credit, 0) - coalesce(t.total_debit, 0)
      else coalesce(t.total_debit, 0) - coalesce(t.total_credit, 0)
    end as amount
  from accounts a
  left join (
    select jl.account_id, sum(jl.debit) as total_debit, sum(jl.credit) as total_credit
    from journal_lines jl
    join journal_entries je
      on je.id = jl.journal_entry_id
     and je.status = 'posted'
     and je.entry_date between p_start_date and p_end_date
    group by jl.account_id
  ) t on t.account_id = a.id
  where a.organization_id = p_org_id
    and a.type in ('revenue', 'expense')
    and (
      (p_tax_line_id is not null and a.tax_line_id = p_tax_line_id)
      or (p_tax_line_id is null and a.tax_line_id is null and a.type = p_type)
    )
  order by a.account_number;
$$;

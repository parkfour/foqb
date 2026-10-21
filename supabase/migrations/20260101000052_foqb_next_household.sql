-- ============================================================================
-- Household workspaces: an organization can be a household instead of a
-- business, with a checkbook-style register, properties valued by hand and
-- a net worth history. Same ledger, same rules; only the screens differ.
-- ============================================================================

alter table organizations
  add column workspace_type text not null default 'business'
  check (workspace_type in ('business', 'household'));

-- The register's "cleared" checkmark. Bookkeeping only, so it may change on
-- posted lines (guard_journal_lines only protects the amounts and accounts).
alter table journal_lines
  add column cleared boolean not null default false;

alter table bank_transactions
  add column cleared boolean not null default false;

-- Homes and other property, valued by hand. They sit outside the ledger:
-- net worth adds their estimated value to the account balances, so don't
-- also record the same property as an asset account.
create table properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  address_street text,
  address_city text,
  address_state text,
  address_zip text,
  purchase_price numeric(14, 2),
  purchase_date date,
  estimated_value numeric(14, 2),
  last_valuation_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_properties_org on properties (organization_id);

alter table properties enable row level security;

create policy "Members can view properties"
  on properties for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert properties"
  on properties for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update properties"
  on properties for update
  using (is_org_writer(organization_id));

create policy "Writers can delete properties"
  on properties for delete
  using (is_org_writer(organization_id));

create policy "Require MFA when enrolled"
  on properties as restrictive to authenticated
  using (mfa_satisfied()) with check (mfa_satisfied());

-- One row per day the dashboard was looked at, for the net worth chart.
create table net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  date date not null,
  total_assets numeric(14, 2) not null,
  total_liabilities numeric(14, 2) not null,
  net_worth numeric(14, 2) not null,
  breakdown jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, date)
);

alter table net_worth_snapshots enable row level security;

create policy "Members can view net worth snapshots"
  on net_worth_snapshots for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert net worth snapshots"
  on net_worth_snapshots for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update net worth snapshots"
  on net_worth_snapshots for update
  using (is_org_writer(organization_id));

create policy "Writers can delete net worth snapshots"
  on net_worth_snapshots for delete
  using (is_org_writer(organization_id));

create policy "Require MFA when enrolled"
  on net_worth_snapshots as restrictive to authenticated
  using (mfa_satisfied()) with check (mfa_satisfied());

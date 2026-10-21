-- ============================================================================
-- Fixed assets + straight-line depreciation. Manual-trigger, same reasoning
-- as recurring invoices/bills: no scheduler exists yet, so each asset just
-- surfaces as "due" for its next monthly depreciation entry.
--
-- accumulated_months (how many periods have actually been posted) lives on
-- the row itself rather than being derived by re-summing journal_lines —
-- same "state lives with the template" choice recurring_invoices/
-- recurring_bills already made, and it's what lets "due" and net book value
-- be computed without a query across the ledger.
-- ============================================================================

create table fixed_assets (
  id                                uuid primary key default gen_random_uuid(),
  organization_id                   uuid not null references organizations (id) on delete cascade,
  name                              text not null,
  asset_account_id                  uuid not null references accounts (id),
  accumulated_depreciation_account_id uuid not null references accounts (id),
  depreciation_expense_account_id   uuid not null references accounts (id),
  purchase_date                     date not null,
  cost                              numeric(12, 2) not null check (cost > 0),
  salvage_value                     numeric(12, 2) not null default 0 check (salvage_value >= 0),
  useful_life_months                integer not null check (useful_life_months > 0),
  accumulated_months                integer not null default 0,
  next_depreciation_date            date not null,
  is_active                         boolean not null default true,
  created_at                        timestamptz not null default now(),
  check (salvage_value < cost)
);

create index idx_fixed_assets_org on fixed_assets (organization_id);

alter table fixed_assets enable row level security;

create policy "Members can view fixed assets"
  on fixed_assets for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert fixed assets"
  on fixed_assets for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update fixed assets"
  on fixed_assets for update
  using (is_org_writer(organization_id));

create policy "Writers can delete fixed assets"
  on fixed_assets for delete
  using (is_org_writer(organization_id));

-- Reuses the audit trigger function from the audit_log migration — fixed
-- assets are exactly the kind of accounting-critical table that log covers.
create trigger audit_fixed_assets
  after insert or update or delete on fixed_assets
  for each row execute function audit_trigger_fn();

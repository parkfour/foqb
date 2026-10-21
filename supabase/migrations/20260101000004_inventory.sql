-- ============================================================================
-- Inventory: minimal item tracking (sku, name, quantity, unit cost), gated
-- per-organization by organizations.inventory_enabled. No COGS journal
-- automation — quantity/cost adjustments are recorded here only; posting the
-- accounting entry for a sale or purchase is still a manual journal entry.
-- ============================================================================

create table inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations (id) on delete cascade,
  sku                 varchar(50) not null,
  name                varchar(200) not null,
  quantity_on_hand    numeric(12, 2) not null default 0,
  unit_cost           numeric(12, 2) not null default 0.00 check (unit_cost >= 0),
  asset_account_id    uuid references accounts (id),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (organization_id, sku)
);

create index idx_inventory_items_org on inventory_items (organization_id);

alter table inventory_items enable row level security;

create policy "Members can view inventory items"
  on inventory_items for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert inventory items"
  on inventory_items for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update inventory items"
  on inventory_items for update
  using (is_org_writer(organization_id));

create policy "Writers can delete inventory items"
  on inventory_items for delete
  using (is_org_writer(organization_id));

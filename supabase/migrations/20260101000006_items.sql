-- ============================================================================
-- Items (Products & Services): a catalog of sellable things, each tied to an
-- income account, used on invoice lines. Deliberately separate from
-- inventory_items (which tracks warehouse quantity/cost and is gated by
-- organizations.inventory_enabled) — items exist for every org regardless
-- of whether inventory tracking is on, since invoicing needs them either
-- way. quantity_on_hand here is a simple optional display field, not wired
-- to COGS journal posting (same simplification as inventory_items).
-- ============================================================================

create table items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  name               varchar(200) not null,
  description        text,
  income_account_id  uuid not null references accounts (id),
  sale_price         numeric(12, 2),
  track_quantity     boolean not null default false,
  quantity_on_hand   numeric(12, 2) not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create index idx_items_org on items (organization_id);

alter table items enable row level security;

create policy "Members can view items"
  on items for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert items"
  on items for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update items"
  on items for update
  using (is_org_writer(organization_id));

create policy "Writers can delete items"
  on items for delete
  using (is_org_writer(organization_id));

-- invoice_lines: optional link to the item that drove this line's
-- description/account/price defaults (account can still be overridden, so
-- this is nullable and purely informational/traceability, not enforced).
alter table invoice_lines add column item_id uuid references items (id);

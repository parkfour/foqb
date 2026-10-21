-- ============================================================================
-- Recurring invoices/bills: a template (customer/vendor + line items +
-- frequency + next due date) that the user generates a real invoice/bill
-- from when it's due. Deliberately manual-trigger, not a cron job — this app
-- has no scheduler yet (Vercel/Supabase provisioning, where a cron endpoint
-- would live, is a separate, not-yet-started phase). The dashboard surfaces
-- which templates are due so generating is a one-click action, and the same
-- generate action can later be wired to a cron endpoint without changes.
-- ============================================================================

create type recurrence_frequency as enum ('weekly', 'monthly', 'yearly');

create table recurring_invoices (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  customer_id      uuid not null references customers (id),
  frequency        recurrence_frequency not null,
  next_date        date not null,
  tax_rate         numeric(5, 2) not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table recurring_invoice_lines (
  id                     uuid primary key default gen_random_uuid(),
  recurring_invoice_id   uuid not null references recurring_invoices (id) on delete cascade,
  item_id                uuid references items (id),
  account_id             uuid not null references accounts (id),
  description            text,
  quantity               numeric(12, 2) not null default 1,
  unit_price             numeric(12, 2) not null
);

create table recurring_bills (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  vendor_id        uuid not null references vendors (id),
  frequency        recurrence_frequency not null,
  next_date        date not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table recurring_bill_lines (
  id                  uuid primary key default gen_random_uuid(),
  recurring_bill_id   uuid not null references recurring_bills (id) on delete cascade,
  account_id          uuid not null references accounts (id),
  description         text,
  quantity            numeric(12, 2) not null default 1,
  unit_price          numeric(12, 2) not null
);

create index idx_recurring_invoices_org on recurring_invoices (organization_id);
create index idx_recurring_bills_org on recurring_bills (organization_id);

alter table recurring_invoices enable row level security;
alter table recurring_invoice_lines enable row level security;
alter table recurring_bills enable row level security;
alter table recurring_bill_lines enable row level security;

create policy "Members can view recurring invoices"
  on recurring_invoices for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert recurring invoices"
  on recurring_invoices for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update recurring invoices"
  on recurring_invoices for update
  using (is_org_writer(organization_id));

create policy "Writers can delete recurring invoices"
  on recurring_invoices for delete
  using (is_org_writer(organization_id));

create policy "Members can view recurring invoice lines"
  on recurring_invoice_lines for select
  using (
    exists (
      select 1 from recurring_invoices ri
      where ri.id = recurring_invoice_lines.recurring_invoice_id
        and ri.organization_id in (select get_user_org_ids())
    )
  );

create policy "Writers can insert recurring invoice lines"
  on recurring_invoice_lines for insert
  with check (
    exists (
      select 1 from recurring_invoices ri
      where ri.id = recurring_invoice_lines.recurring_invoice_id
        and is_org_writer(ri.organization_id)
    )
  );

create policy "Writers can delete recurring invoice lines"
  on recurring_invoice_lines for delete
  using (
    exists (
      select 1 from recurring_invoices ri
      where ri.id = recurring_invoice_lines.recurring_invoice_id
        and is_org_writer(ri.organization_id)
    )
  );

create policy "Members can view recurring bills"
  on recurring_bills for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert recurring bills"
  on recurring_bills for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update recurring bills"
  on recurring_bills for update
  using (is_org_writer(organization_id));

create policy "Writers can delete recurring bills"
  on recurring_bills for delete
  using (is_org_writer(organization_id));

create policy "Members can view recurring bill lines"
  on recurring_bill_lines for select
  using (
    exists (
      select 1 from recurring_bills rb
      where rb.id = recurring_bill_lines.recurring_bill_id
        and rb.organization_id in (select get_user_org_ids())
    )
  );

create policy "Writers can insert recurring bill lines"
  on recurring_bill_lines for insert
  with check (
    exists (
      select 1 from recurring_bills rb
      where rb.id = recurring_bill_lines.recurring_bill_id
        and is_org_writer(rb.organization_id)
    )
  );

create policy "Writers can delete recurring bill lines"
  on recurring_bill_lines for delete
  using (
    exists (
      select 1 from recurring_bills rb
      where rb.id = recurring_bill_lines.recurring_bill_id
        and is_org_writer(rb.organization_id)
    )
  );

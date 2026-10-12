-- ============================================================================
-- Customers/Vendors (AR/AP): invoicing, vendor bills, and payments against
-- them. Line items scoped via their parent (no organization_id), matching
-- journal_lines' existing pattern; top-level tables scoped directly.
-- ============================================================================

create table customers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  name              varchar(200) not null,
  email             varchar(255),
  phone             varchar(50),
  billing_address   text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table vendors (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  name              varchar(200) not null,
  email             varchar(255),
  phone             varchar(50),
  address           text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  customer_id       uuid not null references customers (id),
  invoice_number    varchar(50) not null,
  invoice_date      date not null,
  due_date          date,
  status            varchar(20) not null default 'open'
                      check (status in ('open', 'partial', 'paid', 'void')),
  journal_entry_id  uuid references journal_entries (id),
  created_at        timestamptz not null default now()
);

create table invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices (id) on delete cascade,
  description   text,
  account_id    uuid not null references accounts (id),
  quantity      numeric(12, 2) not null default 1,
  unit_price    numeric(12, 2) not null,
  amount        numeric(12, 2) not null check (amount >= 0)
);

create table invoice_payments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations (id) on delete cascade,
  invoice_id          uuid not null references invoices (id),
  payment_date        date not null,
  amount              numeric(12, 2) not null check (amount > 0),
  deposit_account_id  uuid not null references accounts (id),
  journal_entry_id    uuid references journal_entries (id),
  created_at          timestamptz not null default now()
);

create table bills (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  vendor_id         uuid not null references vendors (id),
  bill_number       varchar(50) not null,
  bill_date         date not null,
  due_date          date,
  status            varchar(20) not null default 'open'
                      check (status in ('open', 'partial', 'paid', 'void')),
  journal_entry_id  uuid references journal_entries (id),
  created_at        timestamptz not null default now()
);

create table bill_lines (
  id            uuid primary key default gen_random_uuid(),
  bill_id       uuid not null references bills (id) on delete cascade,
  description   text,
  account_id    uuid not null references accounts (id),
  quantity      numeric(12, 2) not null default 1,
  unit_price    numeric(12, 2) not null,
  amount        numeric(12, 2) not null check (amount >= 0)
);

create table bill_payments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations (id) on delete cascade,
  bill_id             uuid not null references bills (id),
  payment_date        date not null,
  amount              numeric(12, 2) not null check (amount > 0),
  payment_account_id  uuid not null references accounts (id),
  journal_entry_id    uuid references journal_entries (id),
  created_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table customers enable row level security;
alter table vendors enable row level security;
alter table invoices enable row level security;
alter table invoice_lines enable row level security;
alter table invoice_payments enable row level security;
alter table bills enable row level security;
alter table bill_lines enable row level security;
alter table bill_payments enable row level security;

-- customers, vendors: standard direct organization_id split.
create policy "Members can view customers"
  on customers for select
  using (organization_id in (select get_user_org_ids()));
create policy "Writers can insert customers"
  on customers for insert
  with check (is_org_writer(organization_id));
create policy "Writers can update customers"
  on customers for update
  using (is_org_writer(organization_id));
create policy "Writers can delete customers"
  on customers for delete
  using (is_org_writer(organization_id));

create policy "Members can view vendors"
  on vendors for select
  using (organization_id in (select get_user_org_ids()));
create policy "Writers can insert vendors"
  on vendors for insert
  with check (is_org_writer(organization_id));
create policy "Writers can update vendors"
  on vendors for update
  using (is_org_writer(organization_id));
create policy "Writers can delete vendors"
  on vendors for delete
  using (is_org_writer(organization_id));

-- invoices, bills: standard direct organization_id split.
create policy "Members can view invoices"
  on invoices for select
  using (organization_id in (select get_user_org_ids()));
create policy "Writers can insert invoices"
  on invoices for insert
  with check (is_org_writer(organization_id));
create policy "Writers can update invoices"
  on invoices for update
  using (is_org_writer(organization_id));
create policy "Writers can delete invoices"
  on invoices for delete
  using (is_org_writer(organization_id));

create policy "Members can view bills"
  on bills for select
  using (organization_id in (select get_user_org_ids()));
create policy "Writers can insert bills"
  on bills for insert
  with check (is_org_writer(organization_id));
create policy "Writers can update bills"
  on bills for update
  using (is_org_writer(organization_id));
create policy "Writers can delete bills"
  on bills for delete
  using (is_org_writer(organization_id));

-- invoice_payments, bill_payments: standard direct organization_id split.
create policy "Members can view invoice payments"
  on invoice_payments for select
  using (organization_id in (select get_user_org_ids()));
create policy "Writers can insert invoice payments"
  on invoice_payments for insert
  with check (is_org_writer(organization_id));
create policy "Writers can update invoice payments"
  on invoice_payments for update
  using (is_org_writer(organization_id));
create policy "Writers can delete invoice payments"
  on invoice_payments for delete
  using (is_org_writer(organization_id));

create policy "Members can view bill payments"
  on bill_payments for select
  using (organization_id in (select get_user_org_ids()));
create policy "Writers can insert bill payments"
  on bill_payments for insert
  with check (is_org_writer(organization_id));
create policy "Writers can update bill payments"
  on bill_payments for update
  using (is_org_writer(organization_id));
create policy "Writers can delete bill payments"
  on bill_payments for delete
  using (is_org_writer(organization_id));

-- invoice_lines, bill_lines: scoped via the parent's organization, matching
-- journal_lines' pattern (no organization_id column on the child).
create policy "Members can view invoice lines"
  on invoice_lines for select
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and i.organization_id in (select get_user_org_ids())
    )
  );
create policy "Writers can insert invoice lines"
  on invoice_lines for insert
  with check (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and is_org_writer(i.organization_id)
    )
  );
create policy "Writers can update invoice lines"
  on invoice_lines for update
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and is_org_writer(i.organization_id)
    )
  );
create policy "Writers can delete invoice lines"
  on invoice_lines for delete
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and is_org_writer(i.organization_id)
    )
  );

create policy "Members can view bill lines"
  on bill_lines for select
  using (
    exists (
      select 1 from bills b
      where b.id = bill_lines.bill_id
        and b.organization_id in (select get_user_org_ids())
    )
  );
create policy "Writers can insert bill lines"
  on bill_lines for insert
  with check (
    exists (
      select 1 from bills b
      where b.id = bill_lines.bill_id
        and is_org_writer(b.organization_id)
    )
  );
create policy "Writers can update bill lines"
  on bill_lines for update
  using (
    exists (
      select 1 from bills b
      where b.id = bill_lines.bill_id
        and is_org_writer(b.organization_id)
    )
  );
create policy "Writers can delete bill lines"
  on bill_lines for delete
  using (
    exists (
      select 1 from bills b
      where b.id = bill_lines.bill_id
        and is_org_writer(b.organization_id)
    )
  );

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index idx_customers_org on customers (organization_id);
create index idx_vendors_org on vendors (organization_id);
create index idx_invoices_org_customer on invoices (organization_id, customer_id);
create index idx_invoice_lines_invoice on invoice_lines (invoice_id);
create index idx_invoice_payments_invoice on invoice_payments (invoice_id);
create index idx_bills_org_vendor on bills (organization_id, vendor_id);
create index idx_bill_lines_bill on bill_lines (bill_id);
create index idx_bill_payments_bill on bill_payments (bill_id);

-- ============================================================================
-- Stripe payment links (the stripe-payments plugin). A book's owner saves
-- a Stripe secret key and webhook signing secret, encrypted with
-- ENCRYPTION_KEY; no signed-in user can read the table (only the server,
-- after checking the caller). Each payment link made for an invoice is
-- kept, so a payment Stripe reports is recorded once, against the right
-- invoice.
-- ============================================================================

create table organization_stripe_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,
  secret_key text not null,
  webhook_secret text,
  deposit_account_id uuid not null references accounts (id),
  updated_at timestamptz not null default now()
);

alter table organization_stripe_settings enable row level security;
-- No policies: only the service role reads or writes it.

create trigger trg_org_stripe_settings_same_org
  before insert or update of deposit_account_id on organization_stripe_settings for each row
  execute function enforce_same_org('self', 'deposit_account_id', 'accounts');

create table invoice_payment_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  invoice_id uuid not null references invoices (id) on delete cascade,
  stripe_payment_link_id text not null unique,
  url text not null,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'open' check (status in ('open', 'paid', 'closed')),
  invoice_payment_id uuid references invoice_payments (id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_invoice_payment_links_invoice on invoice_payment_links (invoice_id);

alter table invoice_payment_links enable row level security;

create policy "Members can view invoice payment links" on invoice_payment_links for select
  using (organization_id in (select get_user_org_ids()));
create policy "Require MFA when enrolled" on invoice_payment_links as restrictive to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));
-- Written by the server (service role) only.

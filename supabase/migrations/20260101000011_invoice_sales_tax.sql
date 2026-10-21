-- ============================================================================
-- Sales tax on invoices: a rate entered per invoice, posted as a credit to a
-- Sales Tax Payable control account (mirrors ar_account_id/ap_account_id)
-- rather than folded into revenue, plus an org-level default rate to prefill
-- the invoice form. Bills/vendors are out of scope (use tax, not sales tax
-- collected, is a different problem).
-- ============================================================================

alter table organizations add column tax_payable_account_id uuid references accounts (id);
alter table organizations add column default_tax_rate numeric(5, 2);

alter table invoices add column tax_rate numeric(5, 2) not null default 0;
alter table invoices add column tax_amount numeric(12, 2) not null default 0;

-- ============================================================================
-- Explicit AR/AP control account settings, so an org whose chart of
-- accounts doesn't have anything literally named "...receivable"/
-- "...payable" isn't stuck erroring on every invoice/bill. When set, these
-- take priority over the name-based lookup in lib/org/control-accounts.ts.
-- ============================================================================

alter table organizations add column ar_account_id uuid references accounts (id);
alter table organizations add column ap_account_id uuid references accounts (id);

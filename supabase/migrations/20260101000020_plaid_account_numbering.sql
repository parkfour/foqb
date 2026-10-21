-- ============================================================================
-- Plaid-linked accounts were using the raw (truncated) Plaid account id as
-- their account_number — opaque, inconsistent with the org's own numbering
-- scheme, and not even reliably sortable alongside it. account_number is
-- meant to be the account's position in the org's numbering scheme; a
-- technical reference for matching incoming transactions to the right
-- ledger account is a different concern and belongs in its own column.
-- ============================================================================

alter table accounts add column external_account_id text;
alter table accounts add constraint accounts_org_external_account_id_key
  unique (organization_id, external_account_id);

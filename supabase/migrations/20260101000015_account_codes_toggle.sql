-- ============================================================================
-- Per-organization toggle for showing account numbers in the UI (mirrors
-- QuickBooks' "Use account numbers" preference). accounts.account_number
-- stays required and unique underneath either way — turning this off only
-- hides it from display and from manual entry; the app assigns one
-- automatically when a new account is created with it off.
-- ============================================================================

alter table organizations add column use_account_codes boolean not null default true;

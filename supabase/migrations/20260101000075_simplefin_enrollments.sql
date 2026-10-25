-- ============================================================================
-- SimpleFIN beside Plaid: an enrollment says which service feeds it. For
-- SimpleFIN, access_token holds the encrypted access URL (it carries the
-- credentials) and cursor the date of the last sync.
-- ============================================================================

alter table enrollments add column provider text not null default 'plaid'
  check (provider in ('plaid', 'simplefin'));

grant select (provider) on enrollments to authenticated;

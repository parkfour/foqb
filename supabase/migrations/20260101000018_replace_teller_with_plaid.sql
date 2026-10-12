-- ============================================================================
-- Teller shut down (July 2026) and is being replaced with Plaid. The old
-- column names baked the vendor into the schema, which is exactly what made
-- this migration necessary in the first place — generalize them so a future
-- provider swap doesn't require another rename across the whole stack.
-- ============================================================================

alter table bank_transactions rename column teller_transaction_id to external_transaction_id;
alter table bank_transactions rename column teller_account_id to external_account_id;
alter table enrollments rename column teller_enrollment_id to external_item_id;

-- Plaid's /transactions/sync is cursor-paginated; the cursor must be
-- persisted per Item between calls (both the initial enroll-time sync and
-- every later webhook-triggered sync continue from here).
alter table enrollments add column cursor text;

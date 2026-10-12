-- ============================================================================
-- Lets a customer/vendor payment be matched against an actual unreconciled
-- bank transaction instead of always posting a fresh, independent journal
-- entry. Without this, a real deposit/withdrawal could get recorded twice:
-- once via bank sync categorization, once via Receive Payment/Make Payment.
-- ============================================================================

alter table invoice_payments add column bank_transaction_id uuid references bank_transactions (id);
alter table bill_payments add column bank_transaction_id uuid references bank_transactions (id);

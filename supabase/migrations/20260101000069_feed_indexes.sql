-- ============================================================================
-- Indexes the per-row checks were missing. reopen_blocker and
-- recategorize_blocker (computed for every row the register and Bank
-- Transactions list) look up the payments and other feed rows on a
-- transaction's journal entry; without these each lookup scanned the whole
-- table, so the register's cost grew with the square of the history (5,000
-- booked rows: 860 ms down to 120 ms). journal_lines(account_id) is for an
-- account's ledger and balance, which filter on it alone.
-- ============================================================================

create index if not exists idx_bank_transactions_journal_entry on bank_transactions (journal_entry_id);
create index if not exists idx_invoice_payments_journal_entry on invoice_payments (journal_entry_id);
create index if not exists idx_invoice_payments_bank_transaction on invoice_payments (bank_transaction_id);
create index if not exists idx_bill_payments_journal_entry on bill_payments (journal_entry_id);
create index if not exists idx_bill_payments_bank_transaction on bill_payments (bank_transaction_id);
create index if not exists idx_journal_lines_account on journal_lines (account_id);

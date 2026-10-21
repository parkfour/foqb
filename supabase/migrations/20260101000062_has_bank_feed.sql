-- ============================================================================
-- Whether an account is fed by a bank: linked through Plaid, or has bank
-- transactions (from a feed or imported statements). Net Worth uses it to
-- place an account its name doesn't explain: a bank-fed asset is cash, a
-- bank-fed liability a credit card. Read as a computed column
-- (accounts?select=id,has_bank_feed).
-- ============================================================================

create index if not exists idx_bank_transactions_account on bank_transactions (account_id);

create or replace function has_bank_feed(a accounts)
returns boolean
language sql
stable
set search_path = public
as $$
  select a.external_account_id is not null
      or exists (select 1 from bank_transactions bt where bt.account_id = a.id);
$$;

-- ============================================================================
-- Bank reconciliation: matching a bank statement's ending balance against
-- the GL account's posted journal lines, marking the ones that cleared.
--
-- Reconciles against journal_lines for the chosen account (not just
-- bank_transactions), since a manually entered journal entry that touches
-- the same account — a check written by hand, a correcting entry — needs to
-- be reconcilable too, not just synced bank-feed transactions.
-- ============================================================================

create table bank_reconciliations (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references organizations (id) on delete cascade,
  account_id               uuid not null references accounts (id),
  statement_date           date not null,
  statement_ending_balance numeric(12, 2) not null,
  status                   varchar(20) not null default 'in_progress'
                             check (status in ('in_progress', 'completed')),
  created_by               uuid references auth.users (id),
  created_at               timestamptz not null default now(),
  completed_at             timestamptz
);

create index idx_bank_reconciliations_org_account
  on bank_reconciliations (organization_id, account_id);

alter table journal_lines
  add column reconciliation_id uuid references bank_reconciliations (id);

create index idx_journal_lines_reconciliation on journal_lines (reconciliation_id);

alter table bank_reconciliations enable row level security;

create policy "Members can view reconciliations"
  on bank_reconciliations for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can create reconciliations"
  on bank_reconciliations for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update reconciliations"
  on bank_reconciliations for update
  using (is_org_writer(organization_id));

create policy "Writers can delete reconciliations"
  on bank_reconciliations for delete
  using (is_org_writer(organization_id));

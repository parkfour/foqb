-- ============================================================================
-- Several attribution-style FKs to auth.users (who created/changed this
-- row) were declared with no ON DELETE behavior at all, which defaults to
-- NO ACTION — blocking deletion of a user entirely if they'd so much as
-- created a journal entry, reconciliation, or triggered an audit_log
-- entry (which the default chart-of-accounts seed on org creation does
-- immediately). Fixed the same way site_admin_actions' equivalent columns
-- already were: ON DELETE SET NULL — the historical record survives, it
-- just stops naming a user that no longer exists.
-- ============================================================================

alter table journal_entries
  drop constraint journal_entries_created_by_fkey,
  add constraint journal_entries_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

alter table bank_reconciliations
  drop constraint bank_reconciliations_created_by_fkey,
  add constraint bank_reconciliations_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

alter table audit_log
  drop constraint audit_log_changed_by_fkey,
  add constraint audit_log_changed_by_fkey
    foreign key (changed_by) references auth.users (id) on delete set null;

alter table pending_member_accounts
  drop constraint pending_member_accounts_created_by_fkey,
  add constraint pending_member_accounts_created_by_fkey
    foreign key (created_by) references auth.users (id) on delete set null;

alter table site_admins
  drop constraint site_admins_granted_by_fkey,
  add constraint site_admins_granted_by_fkey
    foreign key (granted_by) references auth.users (id) on delete set null;

-- ============================================================================
-- Role enforcement: 'viewer' members get read-only access; only 'owner' and
-- 'accountant' may write. Previously every policy only checked membership
-- (get_user_org_ids()), so a viewer could write exactly like an owner.
-- ============================================================================

create or replace function is_org_writer(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from organization_members
      where organization_id = p_org_id
        and user_id = auth.uid()
        and role in ('owner', 'accountant')
  );
$$;

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------

drop policy "Members can update their organizations" on organizations;

create policy "Writers can update their organizations"
  on organizations for update
  using (is_org_writer(id));

-- ----------------------------------------------------------------------------
-- organization_members
-- ----------------------------------------------------------------------------

drop policy "Members can manage organization members" on organization_members;
drop policy "Members can update organization members" on organization_members;
drop policy "Members can remove organization members" on organization_members;

-- Self-insert stays open (bootstrap: a brand-new org has no members yet, so
-- get_user_org_ids()/is_org_writer() can't approve the first row).
create policy "Members can manage organization members"
  on organization_members for insert
  with check (
    user_id = auth.uid()
    or is_org_writer(organization_id)
  );

create policy "Writers can update organization members"
  on organization_members for update
  using (is_org_writer(organization_id));

create policy "Writers can remove organization members"
  on organization_members for delete
  using (is_org_writer(organization_id));

-- ----------------------------------------------------------------------------
-- accounts
-- ----------------------------------------------------------------------------

drop policy "Members can access accounts" on accounts;

create policy "Members can view accounts"
  on accounts for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert accounts"
  on accounts for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update accounts"
  on accounts for update
  using (is_org_writer(organization_id));

create policy "Writers can delete accounts"
  on accounts for delete
  using (is_org_writer(organization_id));

-- ----------------------------------------------------------------------------
-- journal_entries
-- ----------------------------------------------------------------------------

drop policy "Members can access journal entries" on journal_entries;

create policy "Members can view journal entries"
  on journal_entries for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert journal entries"
  on journal_entries for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update journal entries"
  on journal_entries for update
  using (is_org_writer(organization_id));

create policy "Writers can delete journal entries"
  on journal_entries for delete
  using (is_org_writer(organization_id));

-- ----------------------------------------------------------------------------
-- bank_transactions
-- ----------------------------------------------------------------------------

drop policy "Members can access bank transactions" on bank_transactions;

create policy "Members can view bank transactions"
  on bank_transactions for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert bank transactions"
  on bank_transactions for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update bank transactions"
  on bank_transactions for update
  using (is_org_writer(organization_id));

create policy "Writers can delete bank transactions"
  on bank_transactions for delete
  using (is_org_writer(organization_id));

-- ----------------------------------------------------------------------------
-- journal_lines (scoped via the parent journal entry's organization)
-- ----------------------------------------------------------------------------

drop policy "Members can access journal lines" on journal_lines;

create policy "Members can view journal lines"
  on journal_lines for select
  using (
    exists (
      select 1 from journal_entries je
      where je.id = journal_lines.journal_entry_id
        and je.organization_id in (select get_user_org_ids())
    )
  );

create policy "Writers can insert journal lines"
  on journal_lines for insert
  with check (
    exists (
      select 1 from journal_entries je
      where je.id = journal_lines.journal_entry_id
        and is_org_writer(je.organization_id)
    )
  );

create policy "Writers can update journal lines"
  on journal_lines for update
  using (
    exists (
      select 1 from journal_entries je
      where je.id = journal_lines.journal_entry_id
        and is_org_writer(je.organization_id)
    )
  );

create policy "Writers can delete journal lines"
  on journal_lines for delete
  using (
    exists (
      select 1 from journal_entries je
      where je.id = journal_lines.journal_entry_id
        and is_org_writer(je.organization_id)
    )
  );

-- ----------------------------------------------------------------------------
-- enrollments
-- ----------------------------------------------------------------------------

drop policy "Members can access enrollments" on enrollments;

create policy "Members can view enrollments"
  on enrollments for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert enrollments"
  on enrollments for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update enrollments"
  on enrollments for update
  using (is_org_writer(organization_id));

create policy "Writers can delete enrollments"
  on enrollments for delete
  using (is_org_writer(organization_id));

-- ----------------------------------------------------------------------------
-- categorization_rules
-- ----------------------------------------------------------------------------

drop policy "Members can access categorization rules" on categorization_rules;

create policy "Members can view categorization rules"
  on categorization_rules for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert categorization rules"
  on categorization_rules for insert
  with check (is_org_writer(organization_id));

create policy "Writers can update categorization rules"
  on categorization_rules for update
  using (is_org_writer(organization_id));

create policy "Writers can delete categorization rules"
  on categorization_rules for delete
  using (is_org_writer(organization_id));

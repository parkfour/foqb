-- ============================================================================
-- delete_organization failed on a book with a mortgage note: the notes
-- (20260101000058) point at the book's accounts, which it deletes first.
-- It now deletes the notes before the accounts. Otherwise as of
-- 20260101000024.
-- ============================================================================

create or replace function delete_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_site_admin() then
    raise exception 'Only a Site Admin can delete an organization';
  end if;

  -- Snapshotted before anything is touched, so the log entry has a real
  -- name and member list even once the org and its memberships are gone.
  insert into site_admin_actions (site_admin_id, action, organization_id, organization_name, former_member_ids)
  select auth.uid(), 'delete', o.id, o.name,
    array(select user_id from organization_members where organization_id = o.id)
  from organizations o where o.id = p_org_id;

  update organizations
    set ar_account_id = null, ap_account_id = null, tax_payable_account_id = null
    where id = p_org_id;

  delete from invoice_payments where organization_id = p_org_id;
  delete from bill_payments where organization_id = p_org_id;
  delete from invoices where organization_id = p_org_id;              -- cascades invoice_lines
  delete from bills where organization_id = p_org_id;                 -- cascades bill_lines
  delete from recurring_invoices where organization_id = p_org_id;    -- cascades recurring_invoice_lines
  delete from recurring_bills where organization_id = p_org_id;       -- cascades recurring_bill_lines
  delete from bank_transactions where organization_id = p_org_id;
  delete from journal_entries where organization_id = p_org_id;       -- cascades journal_lines
  delete from bank_reconciliations where organization_id = p_org_id;
  delete from fixed_assets where organization_id = p_org_id;
  delete from inventory_items where organization_id = p_org_id;
  delete from items where organization_id = p_org_id;
  delete from customers where organization_id = p_org_id;
  delete from vendors where organization_id = p_org_id;

  -- The mortgage notes plugin's notes point at the book's accounts.
  delete from mortgage_notes where organization_id = p_org_id;

  delete from accounts where organization_id = p_org_id;

  perform set_config('app.bypass_owner_removal_guard', 'true', true);
  delete from organization_members where organization_id = p_org_id;

  delete from organizations where id = p_org_id;
end;
$$;

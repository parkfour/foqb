-- ============================================================================
-- Last-owner-removal guard: prevents an organization from being locked out
-- by removing or demoting its last or second-to-last owner without a
-- secret set once (at creation, or later if missing) by an existing owner.
-- Enforced as a trigger directly on organization_members, not just an
-- app-level check — it can't be bypassed by a non-owner writer role, a
-- future code path, or a raw REST call against the table.
-- ============================================================================

alter table organizations add column owner_removal_secret_hash text;

-- Settable exactly once per organization — no rotation yet (out of scope
-- until someone actually needs it). Covers both the primary
-- create-organization flow and any organization that predates this
-- feature or was created via backup restore, which can set one later from
-- Settings as long as none is set yet.
create function set_owner_removal_secret(p_org_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_org_owner(p_org_id) then
    raise exception 'Only an owner can set the owner-removal secret';
  end if;

  if p_secret is null or length(trim(p_secret)) < 8 then
    raise exception 'The owner-removal secret must be at least 8 characters';
  end if;

  update organizations
    set owner_removal_secret_hash = crypt(p_secret, gen_salt('bf'))
    where id = p_org_id
      and owner_removal_secret_hash is null;

  if not found then
    raise exception 'This organization already has an owner-removal secret set, or you do not have access to it';
  end if;
end;
$$;

grant execute on function set_owner_removal_secret(uuid, text) to authenticated;

create function has_owner_removal_secret(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select owner_removal_secret_hash is not null
    from organizations
    where id = p_org_id
      and id in (select get_user_org_ids());
$$;

grant execute on function has_owner_removal_secret(uuid) to authenticated;

-- A trigger can't take extra parameters from the calling statement, so the
-- guarded RPCs below stash the caller-supplied secret in a transaction-local
-- setting first — the same pattern already used for
-- request.jwt.claim.sub/email in the RLS/auth stub.
create function check_owner_removal_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_remaining_owners int;
  v_secret_hash text;
  v_supplied_secret text;
begin
  -- delete_organization removes every member (owners included) as part of
  -- deleting the whole org — an already site-admin-gated, fully audited
  -- action with none of this guard's lockout profile (the org and its data
  -- are gone either way). Only that trusted function sets this flag.
  if current_setting('app.bypass_owner_removal_guard', true) = 'true' then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'DELETE' then
    if OLD.role <> 'owner' then
      return OLD;
    end if;
    v_org_id := OLD.organization_id;
  else
    if OLD.role <> 'owner' or NEW.role = 'owner' then
      return NEW;
    end if;
    v_org_id := OLD.organization_id;
  end if;

  select count(*) into v_remaining_owners
    from organization_members
    where organization_id = v_org_id
      and role = 'owner'
      and id <> OLD.id;

  -- Only the last (0 remaining) or second-to-last (1 remaining) owner
  -- being removed needs the secret — with 2+ owners left over this isn't
  -- the lockout scenario this guards against.
  if v_remaining_owners >= 2 then
    return coalesce(NEW, OLD);
  end if;

  select owner_removal_secret_hash into v_secret_hash
    from organizations where id = v_org_id;

  v_supplied_secret := nullif(current_setting('app.owner_removal_secret', true), '');

  if v_secret_hash is null then
    raise exception 'This organization has no owner-removal secret set — set one in Settings before removing its last or second-to-last owner';
  end if;

  if v_supplied_secret is null or crypt(v_supplied_secret, v_secret_hash) <> v_secret_hash then
    raise exception 'Incorrect owner-removal secret';
  end if;

  return coalesce(NEW, OLD);
end;
$$;

create trigger organization_members_owner_removal_guard
  before update or delete on organization_members
  for each row execute function check_owner_removal_guard();

-- The app's sanctioned paths for removing/demoting a member — set the
-- transaction-local secret, then perform the mutation in the same
-- transaction so the trigger above can see it. Permission check mirrors
-- the existing "Writers can remove/update organization members" RLS
-- policies (this function is security definer, so it must re-check
-- explicitly rather than rely on RLS).
create function remove_org_member_guarded(p_member_id uuid, p_secret text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id from organization_members where id = p_member_id;
  if v_org_id is null then
    raise exception 'Member not found';
  end if;

  if not is_org_writer(v_org_id) then
    raise exception 'You do not have permission to remove members from this organization';
  end if;

  perform set_config('app.owner_removal_secret', coalesce(p_secret, ''), true);
  delete from organization_members where id = p_member_id;
end;
$$;

grant execute on function remove_org_member_guarded(uuid, text) to authenticated;

create function update_org_member_role_guarded(p_member_id uuid, p_role member_role, p_secret text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id from organization_members where id = p_member_id;
  if v_org_id is null then
    raise exception 'Member not found';
  end if;

  if not is_org_writer(v_org_id) then
    raise exception 'You do not have permission to update members in this organization';
  end if;

  perform set_config('app.owner_removal_secret', coalesce(p_secret, ''), true);
  update organization_members set role = p_role where id = p_member_id;
end;
$$;

grant execute on function update_org_member_role_guarded(uuid, member_role, text) to authenticated;

-- Re-declared (unchanged signature) to set the owner-removal guard bypass
-- before this function's own `delete from organization_members` — see the
-- comment on check_owner_removal_guard() above for why this specific path
-- is exempt.
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

  delete from accounts where organization_id = p_org_id;

  perform set_config('app.bypass_owner_removal_guard', 'true', true);
  delete from organization_members where organization_id = p_org_id;

  delete from organizations where id = p_org_id;
end;
$$;

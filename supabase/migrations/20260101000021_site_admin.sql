-- ============================================================================
-- Site Admin: a role on the user identity itself, independent of any
-- per-org organization_members.role. Scoped narrowly to access control over
-- organizations (suspend/unsuspend, delete, promote/demote other Site
-- Admins) — deliberately no read access into any org's financial data.
--
-- The first user ever created on an instance becomes a Site Admin
-- automatically (bootstrap trigger below), in addition to becoming the
-- Owner of their own new org via the existing signup flow — so a solo
-- self-hoster never needs two accounts. Since this database already has
-- users, this migration also backfills the earliest-created one.
-- ============================================================================

alter table organizations
  add column status varchar(20) not null default 'active'
    check (status in ('active', 'suspended'));

create table site_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  granted_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

alter table site_admins enable row level security;

create or replace function is_site_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from site_admins where user_id = auth.uid());
$$;

create policy "Site admins can view the site admin list"
  on site_admins for select
  using (is_site_admin());

create policy "Site admins can promote other site admins"
  on site_admins for insert
  with check (is_site_admin());

create policy "Site admins can demote other site admins"
  on site_admins for delete
  using (is_site_admin());

-- An instance with zero Site Admins has no one left who can fix that —
-- unlike a merely-inconvenient mistake, this is unrecoverable without
-- direct database access, so it's blocked outright rather than just
-- discouraged in the UI.
create or replace function prevent_last_site_admin_removal()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from site_admins) <= 1 then
    raise exception 'Cannot remove the last Site Admin';
  end if;
  return old;
end;
$$;

create trigger trg_prevent_last_site_admin_removal
  before delete on site_admins
  for each row execute function prevent_last_site_admin_removal();

-- ----------------------------------------------------------------------------
-- Suspend semantics: change the two functions every existing RLS policy
-- already funnels through, rather than touching each policy individually.
-- ----------------------------------------------------------------------------

-- Reads: a suspended org disappears from get_user_org_ids() for everyone
-- except its owner, who keeps enough read access to use the backup export.
-- This propagates to every table's read policy automatically.
create or replace function get_user_org_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select om.organization_id
    from organization_members om
    join organizations o on o.id = om.organization_id
    where om.user_id = auth.uid()
      and (o.status = 'active' or om.role = 'owner');
$$;

-- Writes: blocked for everyone, including the owner, once suspended. This
-- propagates to every table's write policy automatically.
create or replace function is_org_writer(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from organization_members om
      join organizations o on o.id = om.organization_id
      where om.organization_id = p_org_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'accountant')
        and o.status = 'active'
  );
$$;

-- Status changes go through this function rather than a broad RLS UPDATE
-- grant, so a Site Admin's write access to organizations is scoped to
-- exactly this column — not control accounts, tax settings, etc.
create or replace function set_organization_status(p_org_id uuid, p_status varchar)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_site_admin() then
    raise exception 'Only a Site Admin can change an organization''s status';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Invalid status: %', p_status;
  end if;

  update organizations set status = p_status where id = p_org_id;
end;
$$;

grant execute on function set_organization_status(uuid, varchar) to authenticated;

drop policy "Members can view their organizations" on organizations;
create policy "Members can view their organizations"
  on organizations for select
  using (id in (select get_user_org_ids()) or is_site_admin());

-- ----------------------------------------------------------------------------
-- Fix the pre-existing org-delete bug — in two parts.
--
-- Part 1: deleting an org cascades to accounts, which fires the
-- audit_accounts trigger, which inserts into audit_log referencing the org
-- that's disappearing in the same cascade — an immediate FK violation.
-- audit_log also cascades from organizations, so deferring the check to
-- end-of-statement lets that cascade clean up the audit_log rows before the
-- constraint is ever checked.
-- ----------------------------------------------------------------------------

alter table audit_log drop constraint audit_log_organization_id_fkey;
alter table audit_log add constraint audit_log_organization_id_fkey
  foreign key (organization_id) references organizations (id) on delete cascade
  deferrable initially deferred;

-- ----------------------------------------------------------------------------
-- Part 2: a plain `delete from organizations` also hits a second, separate
-- class of blocker — every account_id-style FK in this schema
-- (journal_lines, invoice_lines, bill_lines, recurring_*_lines,
-- bank_transactions, fixed_assets, items, ...) is deliberately NOT
-- cascading, so a single account/invoice/item can't silently take
-- historical rows down with it. That protection is exactly right for
-- deleting one row — but deleting an entire organization needs everything
-- under it to go together. delete_organization() clears the tables that
-- would otherwise block the cascade, in dependency order, then lets the
-- final delete cascade the rest (accounts, organization_members,
-- enrollments, categorization_rules, audit_log, pending_member_accounts)
-- normally. This is the only sanctioned way to delete an organization —
-- there's deliberately no RLS DELETE policy on organizations itself.
-- ----------------------------------------------------------------------------

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

  -- Explicitly deleted (rather than left to the final cascade) because
  -- both fire audit triggers that insert into audit_log — doing it here,
  -- while the org row still exists, means those inserts are always valid
  -- immediately. The deferred FK on audit_log (above) is what then lets
  -- the single final cascade below clean up every audit_log row for this
  -- org, from this step and every earlier one, in one pass.
  delete from accounts where organization_id = p_org_id;
  delete from organization_members where organization_id = p_org_id;

  delete from organizations where id = p_org_id;
end;
$$;

grant execute on function delete_organization(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Site-admin-only accounts (created via the same generated-password flow as
-- org members) aren't a member of any org, so this tracking table's
-- organization_id needs to become optional. The cleanup cron doesn't
-- reference organization_id at all, so it already covers both cases.
-- ----------------------------------------------------------------------------

alter table pending_member_accounts alter column organization_id drop not null;

-- ----------------------------------------------------------------------------
-- Bootstrap
-- ----------------------------------------------------------------------------

insert into site_admins (user_id)
select id from auth.users order by created_at limit 1
on conflict (user_id) do nothing;

create or replace function bootstrap_first_site_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from auth.users) = 1 then
    insert into site_admins (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_bootstrap_first_site_admin
  after insert on auth.users
  for each row execute function bootstrap_first_site_admin();

-- ----------------------------------------------------------------------------
-- Console read helpers (site_admins/organizations joins into auth.users
-- can't be done from PostgREST directly, same reason get_org_members
-- exists).
-- ----------------------------------------------------------------------------

create function get_site_admins()
returns table (user_id uuid, email text, created_at timestamptz, has_logged_in boolean)
language sql
security definer
stable
set search_path = public
as $$
  select sa.user_id, au.email::text, sa.created_at, (au.last_sign_in_at is not null) as has_logged_in
    from site_admins sa
    join auth.users au on au.id = sa.user_id
    where is_site_admin();
$$;

grant execute on function get_site_admins() to authenticated;

create function get_all_organizations()
returns table (id uuid, name text, status varchar, created_at timestamptz, member_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.status, o.created_at, count(om.id) as member_count
    from organizations o
    left join organization_members om on om.organization_id = o.id
    where is_site_admin()
    group by o.id, o.name, o.status, o.created_at
    order by o.created_at desc;
$$;

grant execute on function get_all_organizations() to authenticated;

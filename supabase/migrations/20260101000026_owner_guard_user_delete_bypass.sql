-- ============================================================================
-- Deleting a user (Supabase Auth admin API / dashboard, or the
-- cleanup-unclaimed-members job) cascades to their organization_members
-- row via the existing FK. If they're the sole owner of an org with no
-- owner-removal secret set — exactly the state of an interrupted test
-- signup — that cascade hit check_owner_removal_guard and failed the
-- whole deletion with an opaque "Database error deleting user".
--
-- User deletion is already gated behind a higher trust boundary (only the
-- service role / Supabase project owner can call it) than the guard's
-- actual threat model (a non-owner writer stripping owners while the org
-- and its other members remain) — the same reasoning already used to
-- exempt delete_organization. So it gets the same bypass, set here via a
-- BEFORE DELETE trigger on auth.users, ahead of the cascade.
-- ============================================================================

create function bypass_owner_removal_guard_for_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.bypass_owner_removal_guard', 'true', true);
  return old;
end;
$$;

create trigger auth_users_owner_removal_guard_bypass
  before delete on auth.users
  for each row execute function bypass_owner_removal_guard_for_user_delete();

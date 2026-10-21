-- ============================================================================
-- Same class of bug as the owner-removal guard's user-delete bypass
-- (20260101000026): deleting a user cascades to their site_admins row via
-- FK, and prevent_last_site_admin_removal() blocked that cascade whenever
-- the user being deleted was the instance's sole Site Admin — exactly the
-- state of a first-and-only test signup, which the bootstrap trigger in
-- 20260101000021 auto-promotes. Surfaced live trying to delete a stuck
-- test account on foqb-public.
--
-- Reuses the same app.bypass_owner_removal_guard flag and the same
-- BEFORE DELETE trigger on auth.users that already sets it — deleting a
-- user is one trust boundary (service role / Supabase Auth admin API),
-- so both guards it can cascade into share one bypass.
-- ============================================================================

create or replace function prevent_last_site_admin_removal()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.bypass_owner_removal_guard', true) = 'true' then
    return old;
  end if;

  if (select count(*) from site_admins) <= 1 then
    raise exception 'Cannot remove the last Site Admin';
  end if;
  return old;
end;
$$;

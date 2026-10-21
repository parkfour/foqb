-- ============================================================================
-- Same underlying bug, a layer deeper: log_site_admin_promotion_demotion()
-- fires AFTER DELETE on site_admins and inserts a NEW site_admin_actions
-- row referencing the just-removed user as target_user_id. When that
-- delete is itself a cascade from deleting the user's auth.users row
-- (see 20260101000026/28), the referenced user no longer exists by the
-- time this INSERT runs — site_admin_actions_target_user_id_fkey's
-- ON DELETE SET NULL only rescues *existing* rows, not a brand-new insert
-- against an already-gone user, so it failed immediately instead.
--
-- Skip logging a "demote" action in that case — the user isn't being
-- demoted while remaining a member of the system, they're being deleted
-- entirely, which doesn't need its own site-admin-audit entry.
-- ============================================================================

create or replace function log_site_admin_promotion_demotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into site_admin_actions (site_admin_id, action, target_user_id)
    values (coalesce(new.granted_by, auth.uid()), 'promote', new.user_id);
    return new;
  else
    if current_setting('app.bypass_owner_removal_guard', true) = 'true' then
      return old;
    end if;

    insert into site_admin_actions (site_admin_id, action, target_user_id)
    values (auth.uid(), 'demote', old.user_id);
    return old;
  end if;
end;
$$;

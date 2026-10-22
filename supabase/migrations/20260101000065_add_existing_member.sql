-- ============================================================================
-- An owner can add someone who already has a login to their book: the
-- add-member form looks the email up and, when there's an account, adds it
-- instead of making a new one. Only the server (service role) can look an
-- email up; signed-in users can't call this.
-- ============================================================================

create or replace function find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function find_user_id_by_email(text) to service_role;

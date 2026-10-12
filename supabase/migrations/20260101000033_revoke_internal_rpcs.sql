-- ============================================================================
-- check_rate_limit and claim_cron_run are SECURITY DEFINER helpers meant
-- only for the server's service-role client, but Supabase grants EXECUTE on
-- every public function to PUBLIC/anon/authenticated by default — so anyone
-- holding the public anon key could call them over PostgREST to lock any
-- email out of login, keep the cleanup jobs from ever running, or grow
-- rate_limit_hits without bound.
-- ============================================================================

revoke execute on function check_rate_limit(text, int, int) from public, anon, authenticated;
revoke execute on function claim_cron_run(text, int) from public, anon, authenticated;

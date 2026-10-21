-- ============================================================================
-- enrollments.access_token (the encrypted Plaid access token) was readable by
-- every org member through RLS. Only server-side code with the service-role
-- key needs it (sync, disconnect), so signed-in users get every column but
-- that one. Inserting/updating it is unaffected (the enroll route writes it).
-- ============================================================================

revoke select on enrollments from anon, authenticated;
grant select (id, organization_id, external_item_id, institution_name, status, disconnect_reason, created_at, cursor)
  on enrollments to authenticated;

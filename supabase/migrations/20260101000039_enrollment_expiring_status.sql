-- ============================================================================
-- 'expiring': Plaid warned (PENDING_EXPIRATION / PENDING_DISCONNECT) that the
-- bank login will stop working soon. Still syncing, but the user should
-- reconnect it (Link update mode). 'error' now means the login already
-- needs that (e.g. ITEM_LOGIN_REQUIRED); 'disconnected' stays for Items that
-- are gone (user disconnected, or access revoked at the bank) and must be
-- linked again from scratch.
-- ============================================================================

alter table enrollments drop constraint if exists enrollments_status_check;
alter table enrollments add constraint enrollments_status_check
  check (status in ('active', 'expiring', 'error', 'disconnected'));

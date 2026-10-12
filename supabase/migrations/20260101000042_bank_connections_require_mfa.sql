-- ============================================================================
-- Connecting a bank (Plaid Link) requires two-factor authentication: a new
-- enrollment can only be saved from a session that has completed a second
-- factor (AAL2). The API routes check this first (lib/auth/mfa.ts) and
-- refuse before any Plaid Item is created; this is the database backstop,
-- so no other code path can save a bank connection without it.
--
-- Only inserts are restricted: disconnecting (an update) stays possible for
-- anyone allowed to manage the enrollment, and the reconnect route checks
-- two-factor itself.
-- ============================================================================

create policy "Connecting a bank requires MFA"
  on enrollments as restrictive for insert to authenticated
  with check (coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2');

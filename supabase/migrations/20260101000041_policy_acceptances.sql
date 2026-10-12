-- ============================================================================
-- Records each user's acceptance of the Terms of Service and Privacy Policy:
-- which version (lib/legal/policy.ts POLICY_VERSION, the date the policies
-- last changed) and when. Written at signup, or on /accept-terms by anyone
-- who hasn't accepted the current version yet: owner-created members, and
-- every user after a policy change.
--
-- Append-only evidence of consent: a user can read and add only their own
-- rows, and nobody can edit or delete one through the API. Rows go away
-- only with the user's own account (on delete cascade).
-- ============================================================================

create table policy_acceptances (
  user_id      uuid not null references auth.users (id) on delete cascade,
  version      text not null,
  accepted_at  timestamptz not null default now(),
  primary key (user_id, version)
);

alter table policy_acceptances enable row level security;

create policy "Users can view their own policy acceptances"
  on policy_acceptances for select
  using (user_id = auth.uid());

create policy "Users can record their own policy acceptance"
  on policy_acceptances for insert
  with check (user_id = auth.uid());

-- Every RLS table needs this (see 20260101000034_require_mfa_when_enrolled.sql).
create policy "Require MFA when enrolled"
  on policy_acceptances as restrictive to authenticated
  using (mfa_satisfied()) with check (mfa_satisfied());

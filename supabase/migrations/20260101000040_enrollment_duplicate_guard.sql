-- ============================================================================
-- Lets the enroll route refuse linking a bank that's already connected to
-- the org (same institution, overlapping account masks) before exchanging
-- the public token — a duplicate Item would import every transaction twice
-- under new ids. Plaid's recommended duplicate check.
--
-- Signed-in users only have column-level SELECT on enrollments (see
-- 20260101000037), so the new columns are granted explicitly.
-- ============================================================================

alter table enrollments add column institution_id text;
alter table enrollments add column account_masks text[] not null default '{}';

grant select (institution_id, account_masks) on enrollments to authenticated;

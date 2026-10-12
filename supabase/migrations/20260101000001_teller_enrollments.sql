-- ============================================================================
-- Teller enrollments
-- ============================================================================

create table enrollments (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations (id) on delete cascade,
  teller_enrollment_id   varchar(100) not null unique,
  access_token           text not null,
  institution_name       varchar(100),
  status                 varchar(20) not null default 'active'
                           check (status in ('active', 'disconnected', 'error')),
  disconnect_reason      text,
  created_at             timestamptz not null default now()
);

alter table enrollments enable row level security;

create policy "Members can access enrollments"
  on enrollments for all
  using (organization_id in (select get_user_org_ids()))
  with check (organization_id in (select get_user_org_ids()));

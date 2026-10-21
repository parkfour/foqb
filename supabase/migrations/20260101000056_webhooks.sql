-- ============================================================================
-- The webhooks plugin: an organization's owners register URLs that receive
-- a signed POST for each event they subscribe to. Deliveries are queued and
-- sent in the background, with retries.
-- ============================================================================

create table organization_webhooks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  url              text not null check (url ~ '^https://' and length(url) <= 2000),
  description      text check (length(description) <= 200),
  events           text[] not null check (
    cardinality(events) > 0
    and events <@ array['invoice:created', 'bill:created', 'invoice_payment:recorded', 'bill_payment:recorded']
  ),
  -- Encrypted by the app (ENCRYPTION_KEY); shown to the owner once, when
  -- the webhook is created, and never readable by signed-in users after.
  secret_encrypted text not null,
  created_at       timestamptz not null default now()
);

create index idx_organization_webhooks_org on organization_webhooks (organization_id);

alter table organization_webhooks enable row level security;

create policy "Owners can view webhooks"
  on organization_webhooks for select
  using (is_org_owner(organization_id));

create policy "Owners can add webhooks"
  on organization_webhooks for insert
  with check (is_org_owner(organization_id));

create policy "Owners can remove webhooks"
  on organization_webhooks for delete
  using (is_org_owner(organization_id));

create policy "Require MFA when enrolled"
  on organization_webhooks as restrictive to authenticated
  using (mfa_satisfied()) with check (mfa_satisfied());

revoke select on organization_webhooks from anon, authenticated;
grant select (id, organization_id, url, description, events, created_at)
  on organization_webhooks to authenticated;

-- One row per message to one webhook. Written and updated only by the
-- server (service role); owners can read their organization's.
create table webhook_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organizations (id) on delete cascade,
  webhook_id           uuid not null references organization_webhooks (id) on delete cascade,
  event                text not null,
  payload              jsonb not null,
  status               text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts             integer not null default 0,
  next_attempt_at      timestamptz not null default now(),
  last_response_status integer,
  last_error           text,
  created_at           timestamptz not null default now(),
  delivered_at         timestamptz
);

create index idx_webhook_deliveries_due on webhook_deliveries (next_attempt_at) where status = 'pending';
create index idx_webhook_deliveries_webhook on webhook_deliveries (webhook_id, created_at desc);

alter table webhook_deliveries enable row level security;

create policy "Owners can view webhook deliveries"
  on webhook_deliveries for select
  using (is_org_owner(organization_id));

create policy "Require MFA when enrolled"
  on webhook_deliveries as restrictive to authenticated
  using (mfa_satisfied()) with check (mfa_satisfied());

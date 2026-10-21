-- ============================================================================
-- The email-invoices plugin: each organization sends through its own mail
-- server, and every invoice sent is recorded.
-- ============================================================================

-- One mail server per organization. The password is encrypted by the app
-- (ENCRYPTION_KEY) and, like enrollments.access_token, never readable by
-- signed-in users: only the server, with the service-role key, reads it to
-- send. Not audited, so the encrypted password never lands in audit_log.
create table organization_smtp_settings (
  organization_id    uuid primary key references organizations (id) on delete cascade,
  host               text not null check (length(host) between 1 and 253),
  port               integer not null check (port between 1 and 65535),
  username           text not null check (length(username) <= 320),
  password_encrypted text not null,
  from_address       text not null check (length(from_address) <= 320),
  reply_to           text check (length(reply_to) <= 320),
  updated_at         timestamptz not null default now()
);

alter table organization_smtp_settings enable row level security;

-- Writers can see whether email is set up (and from where); only owners
-- change it.
create policy "Members can view their org's mail server"
  on organization_smtp_settings for select
  using (organization_id in (select get_user_org_ids()));

create policy "Owners can add a mail server"
  on organization_smtp_settings for insert
  with check (is_org_owner(organization_id));

create policy "Owners can change the mail server"
  on organization_smtp_settings for update
  using (is_org_owner(organization_id));

create policy "Owners can remove the mail server"
  on organization_smtp_settings for delete
  using (is_org_owner(organization_id));

create policy "Require MFA when enrolled"
  on organization_smtp_settings as restrictive to authenticated
  using (mfa_satisfied()) with check (mfa_satisfied());

revoke select on organization_smtp_settings from anon, authenticated;
grant select (organization_id, host, port, username, from_address, reply_to, updated_at)
  on organization_smtp_settings to authenticated;

-- Every invoice emailed: when, by whom, to whom. Written by the send action
-- after the mail server accepted the message; audited like the invoices.
create table invoice_emails (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  invoice_id      uuid not null references invoices (id) on delete cascade,
  sent_to         text not null check (length(sent_to) <= 320),
  subject         text not null check (length(subject) <= 200),
  -- Null once the sender's account is deleted, as with audit_log.
  sent_by         uuid default auth.uid() references auth.users (id) on delete set null,
  sent_at         timestamptz not null default now()
);

create index idx_invoice_emails_invoice on invoice_emails (invoice_id, sent_at desc);

alter table invoice_emails enable row level security;

create policy "Members can view invoice emails"
  on invoice_emails for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can record invoice emails they sent"
  on invoice_emails for insert
  with check (is_org_writer(organization_id) and sent_by = auth.uid());

create policy "Require MFA when enrolled"
  on invoice_emails as restrictive to authenticated
  using (mfa_satisfied()) with check (mfa_satisfied());

create trigger trg_invoice_emails_same_org
  before insert or update of invoice_id
  on invoice_emails for each row
  execute function enforce_same_org('self', 'invoice_id', 'invoices');

create trigger audit_invoice_emails
  after insert or update or delete on invoice_emails
  for each row execute function audit_trigger_fn();

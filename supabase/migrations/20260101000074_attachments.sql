-- ============================================================================
-- Attachments: the receipt, invoice PDF or statement behind a journal entry.
-- Every bill, expense and bank booking has an entry, so attaching to the
-- entry covers them all.
--
-- The file itself is kept in the row (bytea), not in Supabase Storage: the
-- Docker stack has no storage service, and this way a file has the same
-- row-level security, MFA rule and database backups as the books.
-- ponytail: files live in Postgres, 4 MB each; move to object storage if
-- books grow to many gigabytes of attachments.
-- ============================================================================

create table attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  journal_entry_id uuid not null references journal_entries (id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 255),
  content_type text not null check (
    content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif')
  ),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  data bytea not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (octet_length(data) = size_bytes)
);

create index idx_attachments_entry on attachments (journal_entry_id);
create index idx_attachments_org on attachments (organization_id);

alter table attachments enable row level security;

create policy "Members can view attachments"
  on attachments for select
  using (organization_id in (select get_user_org_ids()));

create policy "Writers can insert attachments"
  on attachments for insert
  with check (is_org_writer(organization_id));

create policy "Writers can delete attachments"
  on attachments for delete
  using (is_org_writer(organization_id));

create policy "Require MFA when enrolled"
  on attachments as restrictive to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));

create trigger trg_attachments_same_org
  before insert or update of journal_entry_id
  on attachments for each row
  execute function enforce_same_org('self', 'journal_entry_id', 'journal_entries');

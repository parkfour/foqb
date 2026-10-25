-- ============================================================================
-- Booking between your own books: one event that touches two books, such
-- as a business expense paid with a personal card (the household owes
-- nothing to the card company on the business's behalf until the business
-- pays it back), an owner's draw, or money put into the business. Both
-- entries post in one transaction, or neither does, and are linked so each
-- book can show the other side.
-- ============================================================================

create table inter_book_links (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('transfer', 'paid_for')),
  memo text,
  org_a uuid not null references organizations (id) on delete cascade,
  entry_a uuid not null references journal_entries (id) on delete cascade,
  org_b uuid not null references organizations (id) on delete cascade,
  entry_b uuid not null references journal_entries (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (org_a <> org_b)
);

create index idx_inter_book_links_entry_a on inter_book_links (entry_a);
create index idx_inter_book_links_entry_b on inter_book_links (entry_b);

alter table inter_book_links enable row level security;

-- Either book's members see the link (each still sees only its own entry).
create policy "Members of either book can view the link" on inter_book_links for select
  using (org_a in (select get_user_org_ids()) or org_b in (select get_user_org_ids()));
create policy "Writers in both books can link" on inter_book_links for insert
  with check (is_org_writer(org_a) and is_org_writer(org_b));
create policy "Require MFA when enrolled" on inter_book_links as restrictive to authenticated
  using ((select mfa_satisfied())) with check ((select mfa_satisfied()));

-- p_a and p_b: { "org_id", "lines": [{account_id, debit, credit}],
-- "bank_transaction_id" (optional) }. SECURITY INVOKER: the caller must be
-- able to post in both books, exactly as if posting each by hand.
create or replace function post_between_books(
  p_kind text,
  p_entry_date date,
  p_memo text,
  p_a jsonb,
  p_b jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_link uuid;
begin
  if (p_a->>'org_id')::uuid = (p_b->>'org_id')::uuid then
    raise exception 'Choose two different books';
  end if;

  v_a := post_journal_entry((p_a->>'org_id')::uuid, p_entry_date, p_memo, p_a->'lines', nullif(p_a->>'bank_transaction_id', '')::uuid);
  v_b := post_journal_entry((p_b->>'org_id')::uuid, p_entry_date, p_memo, p_b->'lines', nullif(p_b->>'bank_transaction_id', '')::uuid);

  insert into inter_book_links (kind, memo, org_a, entry_a, org_b, entry_b)
  values (p_kind, p_memo, (p_a->>'org_id')::uuid, v_a, (p_b->>'org_id')::uuid, v_b)
  returning id into v_link;

  return v_link;
end;
$$;

revoke execute on function post_between_books(text, date, text, jsonb, jsonb) from anon, public;
grant execute on function post_between_books(text, date, text, jsonb, jsonb) to authenticated;

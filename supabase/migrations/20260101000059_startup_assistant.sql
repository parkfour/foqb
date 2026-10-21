-- ============================================================================
-- The start-up assistant (plugins/startup-assistant). While a book is being
-- started, each account's opening balance is where its books start: it
-- already holds everything dated on or before it. So, until the book says
-- it's done:
--   1. Nothing new can be booked to an account on or before its start
--      (another account's old transfer to it belongs to equity).
--   2. startup_clean_up() moves what already was to equity.
-- The opening memos are OPENING_BALANCE_MEMO, STATEMENT_OPENING_MEMO and
-- SETTLED_MEMO in the app; keep them the same.
-- ============================================================================

create table startup_assistant (
  organization_id uuid primary key references organizations (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table startup_assistant enable row level security;

create policy "Members can view the start-up assistant"
  on startup_assistant for select
  using (organization_id in (select get_user_org_ids()));
create policy "Writers can start the start-up assistant"
  on startup_assistant for insert
  with check (is_org_writer(organization_id));
create policy "Writers can finish the start-up assistant"
  on startup_assistant for update
  using (is_org_writer(organization_id));
create policy "Require MFA when enrolled"
  on startup_assistant as restrictive to authenticated
  using (mfa_satisfied()) with check (mfa_satisfied());

create or replace function is_opening_memo(p_memo text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_memo in ('Opening balance', 'Opening balance (statement)', 'Balance adjustment (history settled)'), false)
$$;

-- The date of an account's opening balance: its books hold everything
-- dated on or before it. Null for equity (the other side of every
-- opening) and for an account without one.
create or replace function books_start(p_account uuid)
returns date
language sql
stable
set search_path = public
as $$
  select max(je.entry_date)
    from journal_lines jl
    join journal_entries je on je.id = jl.journal_entry_id
    join accounts a on a.id = jl.account_id
   where jl.account_id = p_account
     and a.type <> 'equity'
     and je.status = 'posted'
     and je.memo in ('Opening balance', 'Opening balance (statement)')
$$;

create or replace function guard_books_start()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_date date;
  v_memo text;
  v_start date;
  v_name text;
begin
  select organization_id, entry_date, memo into v_org, v_date, v_memo
    from journal_entries where id = new.journal_entry_id;
  -- A reconciled line is history being re-booked as it was (clean-up).
  if is_opening_memo(v_memo) or new.reconciliation_id is not null
     or not exists (select 1 from startup_assistant where organization_id = v_org and finished_at is null) then
    return new;
  end if;
  v_start := books_start(new.account_id);
  if v_start is not null and v_date <= v_start then
    select name into v_name from accounts where id = new.account_id;
    raise exception '%''s books start on % and its opening balance already holds what came before: book this to equity instead',
      v_name, v_start;
  end if;
  return new;
end;
$$;

create trigger trg_guard_books_start
  before insert on journal_lines
  for each row execute function guard_books_start();

-- Each account with an opening balance: where its books start, how many
-- entries reach back before that (not reconciled there), and how many feed
-- rows from before it are still waiting.
create or replace function startup_overview(p_org uuid)
returns table (account_id uuid, account_name text, starts_on date, early_entries int, early_rows int)
language sql
stable
set search_path = public
as $$
  with starts as (
    select a.id, a.name, books_start(a.id) as starts_on
      from accounts a
     where a.organization_id = p_org and a.type <> 'equity'
  )
  select s.id, s.name::text, s.starts_on,
         (select count(distinct je.id)::int
            from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id
           where jl.account_id = s.id and je.status = 'posted' and not is_opening_memo(je.memo)
             and jl.reconciliation_id is null and je.entry_date <= s.starts_on),
         (select count(*)::int from bank_transactions bt
           where bt.account_id = s.id and bt.status = 'unreconciled' and bt.date <= s.starts_on)
    from starts s
   where s.starts_on is not null
   order by s.name
$$;

-- Re-books each entry that reaches back before an account's start with
-- that line on equity instead: the entry is voided and booked again with
-- its other lines (and their reconciliations) as they were. The early
-- account's bank row goes to history (ignored); the others follow the new
-- entry. A line already reconciled on the early account stays (a settled
-- history adjusted for it). Feed rows from before an account's start are
-- set aside too.
create or replace function startup_clean_up(p_org uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_equity uuid;
  v_entry record;
  v_new uuid;
  v_early uuid[];
  v_moved int := 0;
  v_kept int := 0;
  v_ignored int;
begin
  if not is_org_writer(p_org) then
    raise exception 'You can''t change this book';
  end if;
  select id into v_equity from accounts
   where organization_id = p_org and type = 'equity' and is_active
   order by account_number limit 1;
  if v_equity is null then
    raise exception 'The book needs an equity account to move the history to';
  end if;

  for v_entry in
    select distinct je.id, je.entry_date, je.memo
      from journal_lines jl join journal_entries je on je.id = jl.journal_entry_id
     where je.organization_id = p_org and je.status = 'posted' and not is_opening_memo(je.memo)
       and jl.reconciliation_id is null and je.entry_date <= books_start(jl.account_id)
     order by je.entry_date, je.id
  loop
    begin
      select array_agg(jl.account_id) into v_early
        from journal_lines jl
       where jl.journal_entry_id = v_entry.id and jl.reconciliation_id is null
         and v_entry.entry_date <= books_start(jl.account_id);

      insert into journal_entries (organization_id, entry_date, memo, status, created_by)
      values (p_org, v_entry.entry_date, v_entry.memo, 'draft', auth.uid())
      returning id into v_new;
      insert into journal_lines (journal_entry_id, account_id, description, debit, credit, reconciliation_id)
      select v_new,
             case when jl.reconciliation_id is null and jl.account_id = any (v_early) then v_equity else jl.account_id end,
             jl.description, jl.debit, jl.credit, jl.reconciliation_id
        from journal_lines jl where jl.journal_entry_id = v_entry.id;
      update journal_entries set status = 'posted' where id = v_new;

      update journal_lines set reconciliation_id = null where journal_entry_id = v_entry.id;
      update journal_entries set status = 'void' where id = v_entry.id;
      update bank_transactions set status = 'ignored', journal_entry_id = null
       where journal_entry_id = v_entry.id and account_id = any (v_early);
      update bank_transactions set journal_entry_id = v_new where journal_entry_id = v_entry.id;
      v_moved := v_moved + 1;
    exception when others then
      v_kept := v_kept + 1; -- a locked period, say: left for a person to look at
    end;
  end loop;

  update bank_transactions set status = 'ignored'
   where organization_id = p_org and status = 'unreconciled' and date <= books_start(account_id);
  get diagnostics v_ignored = row_count;

  return jsonb_build_object('moved', v_moved, 'kept', v_kept, 'ignored', v_ignored);
end;
$$;

-- ============================================================================
-- Posts a journal entry with its lines in one transaction.
--
-- Callers used to insert a draft entry, insert its lines, flip it to
-- posted, then write whatever referenced it, as separate requests, with a
-- best-effort delete to "roll back" on failure. A failure after posting
-- left a posted entry behind (and the delete itself is refused inside a
-- locked period). One function call is one transaction: all or nothing.
--
-- p_bank_transaction_id, when given, marks that bank transaction matched to
-- the new entry in the same transaction, and only if it's still
-- unreconciled, so two concurrent categorizations can't both post an
-- entry for the same bank transaction.
--
-- SECURITY INVOKER: RLS applies exactly as it did to the individual writes.
-- ============================================================================

create or replace function post_journal_entry(
  p_org_id uuid,
  p_entry_date date,
  p_memo text,
  p_lines jsonb,
  p_bank_transaction_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_entry_id uuid;
begin
  insert into journal_entries (organization_id, entry_date, memo, status, created_by)
  values (p_org_id, p_entry_date, p_memo, 'draft', auth.uid())
  returning id into v_entry_id;

  insert into journal_lines (journal_entry_id, account_id, description, debit, credit)
  select v_entry_id, x.account_id, x.description, coalesce(x.debit, 0), coalesce(x.credit, 0)
    from jsonb_to_recordset(p_lines) as x(account_id uuid, description text, debit numeric, credit numeric);

  update journal_entries set status = 'posted' where id = v_entry_id;

  if p_bank_transaction_id is not null then
    update bank_transactions
       set status = 'matched', journal_entry_id = v_entry_id
     where id = p_bank_transaction_id
       and organization_id = p_org_id
       and status = 'unreconciled';

    if not found then
      raise exception 'That bank transaction is not an available unreconciled transaction';
    end if;
  end if;

  return v_entry_id;
end;
$$;

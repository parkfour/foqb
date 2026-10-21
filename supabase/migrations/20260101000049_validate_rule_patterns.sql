-- ============================================================================
-- A categorization rule with an invalid regular expression made every bank
-- transaction match fail (the ~* in match_bank_transaction raises), so one
-- bad rule stopped an organization's whole bank feed. Active regex rules
-- are now checked with Postgres's own regex engine (the one that runs
-- them; JavaScript's accepts and rejects different patterns), and any
-- invalid ones already saved are switched off.
-- ============================================================================

create or replace function validate_rule_pattern()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.match_type = 'regex' and new.is_active then
    begin
      perform '' ~* new.match_text;
    exception when invalid_regular_expression then
      raise exception 'The pattern "%" isn''t a valid regular expression', new.match_text;
    end;
  end if;
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in select id, match_text from categorization_rules where match_type = 'regex' and is_active loop
    begin
      perform '' ~* r.match_text;
    exception when invalid_regular_expression then
      update categorization_rules set is_active = false where id = r.id;
    end;
  end loop;
end;
$$;

create trigger trg_validate_rule_pattern
  before insert or update on categorization_rules
  for each row execute function validate_rule_pattern();

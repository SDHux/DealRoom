-- Base-plan usage cap: 25 active deal rooms per org. Stored per-org (not hardcoded in the
-- trigger) so a specific customer's limit can be raised with a plain UPDATE, and so a
-- future multi-tier system can set different values per plan, without another migration.
-- Applies uniformly to every org for now -- there's no real billing-tier distinction to
-- key off yet.
alter table organizations add column deal_room_limit int not null default 25;

-- The actual enforcement -- client-side checks are just for a clean UX, not the real
-- gate, matching every other business rule in this app (never trust client-only checks).
-- Only fires on insert, so updates (editing an existing deal) and merges (spreadsheet
-- re-import matching an existing deal by company name) are never affected -- only a
-- genuinely new row counts against the limit.
create or replace function public.enforce_deal_room_limit()
returns trigger
language plpgsql
as $$
declare
  v_limit int;
  v_count int;
begin
  select deal_room_limit into v_limit from organizations where id = new.org_id;
  select count(*) into v_count from deals where org_id = new.org_id and archived_at is null;

  if v_count >= v_limit then
    raise exception 'Plan limit reached: this organization can have at most % active deal rooms', v_limit;
  end if;

  return new;
end;
$$;

create trigger enforce_deal_room_limit
  before insert on deals
  for each row execute function public.enforce_deal_room_limit();

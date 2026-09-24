-- Team tiers: deal_room_limit applies per rep (the deal's assignee).
-- Solo/trial: applies to the whole workspace, as before.
create or replace function public.enforce_deal_room_limit()
returns trigger
language plpgsql
as $$
declare
  v_limit int;
  v_tier text;
  v_rep uuid;
  v_count int;
begin
  select deal_room_limit, plan_tier into v_limit, v_tier from organizations where id = new.org_id;

  if v_tier like 'team\_%' then
    v_rep := coalesce(new.assigned_to, new.created_by);
    select count(*) into v_count from deals
      where org_id = new.org_id and archived_at is null
        and coalesce(assigned_to, created_by) = v_rep;
    if v_count >= v_limit then
      raise exception 'Plan limit reached: each rep can have at most % active deal rooms', v_limit;
    end if;
  else
    select count(*) into v_count from deals where org_id = new.org_id and archived_at is null;
    if v_count >= v_limit then
      raise exception 'Plan limit reached: this organization can have at most % active deal rooms', v_limit;
    end if;
  end if;

  return new;
end;
$$;

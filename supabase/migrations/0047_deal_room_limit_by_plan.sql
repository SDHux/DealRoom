-- Solo/trial workspaces get 5 active deal rooms; any Team tier gets 10.
-- Derived from plan_tier so a Stripe purchase or tier change (which updates
-- plan_tier via the webhook) moves the limit automatically.
create or replace function public.set_deal_room_limit_from_plan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.deal_room_limit := case when new.plan_tier like 'team\_%' then 10 else 5 end;
  return new;
end;
$$;

revoke all on function public.set_deal_room_limit_from_plan() from public, anon, authenticated;

create trigger set_deal_room_limit_from_plan
before insert or update of plan_tier on public.organizations
for each row execute function public.set_deal_room_limit_from_plan();

alter table public.organizations alter column deal_room_limit set default 5;

update public.organizations
set deal_room_limit = case when plan_tier like 'team\_%' then 10 else 5 end;

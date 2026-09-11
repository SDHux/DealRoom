-- AI Coach (netlify/functions/ai-coach.mts) had no authentication or usage limit at all --
-- any caller who found the endpoint URL could run unlimited requests against the shared
-- ANTHROPIC_API_KEY, myBivy user or not. The function now requires the caller's Supabase
-- access token and org membership (mirrors create-checkout-session.mts's auth pattern),
-- and this migration adds the other half: a hard per-org monthly cap, checked and
-- incremented atomically before the org is allowed to reach Anthropic at all.
--
-- Rep-only by product decision (prospect access to AI Coach was tried, then dropped --
-- the client already keeps the AI panel and its trigger buttons behind viewMode==="rep";
-- this is the server-side backstop for that same boundary, not a new restriction).

create table if not exists ai_coach_usage (
  org_id uuid not null references organizations(id) on delete cascade,
  period_month date not null, -- always the 1st of the month, e.g. 2026-09-01
  request_count int not null default 0,
  primary key (org_id, period_month)
);

alter table ai_coach_usage enable row level security;

-- No policies -- no direct client access at all, matching stripe_customer_id's column-lock
-- reasoning in 0018. Reads/writes only ever happen through the SECURITY DEFINER RPC below,
-- called by the ai-coach Netlify function on the authenticated rep's behalf.
revoke all on ai_coach_usage from anon, authenticated;

-- 300/month is a starting number for the single $48/mo Beta tier -- easy to raise here
-- later without touching function code. Returns the post-check state either way so the
-- caller can show "X of 300 used" without a second round trip.
create or replace function public.check_and_increment_ai_coach_usage(p_org_id uuid)
returns table(allowed boolean, request_count int, monthly_cap int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap constant int := 300;
  v_month date := date_trunc('month', now())::date;
  v_count int;
begin
  if not is_org_member(p_org_id) then
    raise exception 'Not authorized for this organization''s AI Coach usage';
  end if;

  insert into ai_coach_usage (org_id, period_month, request_count)
  values (p_org_id, v_month, 0)
  on conflict (org_id, period_month) do nothing;

  select ac.request_count into v_count
  from ai_coach_usage ac
  where ac.org_id = p_org_id and ac.period_month = v_month
  for update;

  if v_count >= v_cap then
    return query select false, v_count, v_cap;
    return;
  end if;

  update ai_coach_usage
  set request_count = request_count + 1
  where org_id = p_org_id and period_month = v_month
  returning ai_coach_usage.request_count into v_count;

  return query select true, v_count, v_cap;
end;
$$;

revoke all on function public.check_and_increment_ai_coach_usage(uuid) from public;
grant execute on function public.check_and_increment_ai_coach_usage(uuid) to authenticated;

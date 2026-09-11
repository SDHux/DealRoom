-- Lowers the AI Coach monthly cap from the 300 placeholder in 0029 to Mark's actual
-- chosen number, 60/month per org. Same CREATE OR REPLACE shape as 0022's deal-room-limit
-- adjustment -- only the constant changes, everything else in the function is identical.
create or replace function public.check_and_increment_ai_coach_usage(p_org_id uuid)
returns table(allowed boolean, request_count int, monthly_cap int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap constant int := 60;
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

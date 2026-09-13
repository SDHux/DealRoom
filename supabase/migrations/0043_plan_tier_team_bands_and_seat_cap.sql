-- Team Admin/Manager Rework, Data model #7 + Pricing section: plan_tier needs to represent
-- which Team pricing band an org is on (so seat-cap enforcement and Admin Portal gating
-- have something real to check instead of inferring Team-ness from member count), and Team
-- orgs need to never pass through 'trial' at all -- there's no trial period for Team,
-- confirmed decision. Solo's existing 'trial' value and whatever states its own trial/
-- conversion flow uses are untouched; this only adds three new values alongside them.
--
-- plan_tier represents which PRODUCT BAND an org is on (Solo vs. one of the three Team
-- seat-count bands) -- billing STATE (trialing/active/past_due/canceled/incomplete) is
-- already a separate column, subscription_status, and stays that column's job; this isn't
-- duplicating it. 'trial' is Solo's existing (and today, only) value in production --
-- unchanged, still what a Solo signup gets. The three team_* values are new; a Team org
-- gets one of these directly at signup, never 'trial'.
--
-- Schema-only in this migration: the actual checkout/Stripe flow that sets an org's
-- plan_tier to one of the team_* values at signup is separate application work (Netlify
-- functions), not part of this data-model chunk.
alter table organizations add constraint organizations_plan_tier_check
  check (plan_tier in ('trial', 'team_5', 'team_10', 'team_15'));

-- Seat cap per band, per the Team pricing table (up to 5 / 10 / 15 reps, hard caps, no
-- metering within a band -- crossing one requires upgrading to the next). Returns null for
-- every non-Team plan_tier, meaning "no cap" (Solo orgs are never subject to this).
create or replace function public.plan_tier_seat_cap(p_plan_tier text)
returns integer
language sql
immutable
as $$
  select case p_plan_tier
    when 'team_5' then 5
    when 'team_10' then 10
    when 'team_15' then 15
    else null
  end;
$$;

-- Enforced at the point a new organization_members row would be created -- covers both the
-- existing invite path and the new invite-provisioning flow (Data model #1, not yet built),
-- since both ultimately insert a row here. Only fires for an org whose plan_tier maps to a
-- cap; Solo orgs (plan_tier_seat_cap returns null) are never touched by this trigger.
create or replace function public.enforce_seat_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_tier text;
  v_cap integer;
  v_current_count integer;
begin
  select plan_tier into v_plan_tier from organizations where id = new.org_id;
  v_cap := plan_tier_seat_cap(v_plan_tier);

  if v_cap is not null then
    select count(*) into v_current_count
    from organization_members
    where org_id = new.org_id and status != 'deactivated';

    if v_current_count >= v_cap then
      raise exception 'This organization''s plan (% seats) is at capacity -- upgrade to a larger tier before adding another teammate.', v_cap;
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_seat_cap
  before insert on organization_members
  for each row execute function public.enforce_seat_cap();

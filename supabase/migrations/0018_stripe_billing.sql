-- Wires up the billing columns organizations has carried unused since 0002 (plan_tier,
-- stripe_customer_id): a single paid tier, a 14-day trial, and a soft lock (rep-side only --
-- prospect share links are never affected) once the trial ends or a payment fails.

alter table organizations add column stripe_subscription_id text;
alter table organizations add column subscription_status text not null default 'trialing'
  check (subscription_status in ('trialing','active','past_due','canceled','incomplete'));
alter table organizations add column trial_ends_at timestamptz not null default (now() + interval '14 days');
alter table organizations add column current_period_end timestamptz;

-- organizations_update (0002) is owner-only but row-level, not column-level -- as it stands
-- any org owner could open devtools and UPDATE their own row's subscription_status to
-- 'active' directly, bypassing payment entirely. Now that these columns are the actual
-- paywall gate, lock them down at the column-privilege layer (a second, independent check
-- below RLS) so only a SECURITY DEFINER function or the webhook's service-role connection
-- can write them -- never a plain authenticated client update, even from the owner's own
-- session. deal_room_limit (0017) gets the same treatment while we're in here: same class
-- of self-service bypass (an owner raising their own quota), lower stakes, same fix.
revoke update (
  stripe_customer_id, stripe_subscription_id, subscription_status, trial_ends_at,
  current_period_end, deal_room_limit
) on organizations from authenticated;

-- The one owner-initiated write to a locked-down column: recording the Stripe customer id
-- the first time an org checks out. Mirrors set_org_logo's shape (0011) -- a narrow,
-- single-purpose SECURITY DEFINER RPC instead of loosening the column lock generally.
create or replace function public.set_org_stripe_customer_id(p_org_id uuid, p_customer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_org_role(p_org_id) is distinct from 'owner' then
    raise exception 'Not authorized to manage this organization''s billing';
  end if;

  update organizations set stripe_customer_id = p_customer_id where id = p_org_id;
end;
$$;

revoke all on function public.set_org_stripe_customer_id(uuid, text) from public;
grant execute on function public.set_org_stripe_customer_id(uuid, text) to authenticated;

-- The real enforcement -- client-side checks are for a clean UX only, matching every other
-- business rule in this app. 'active' or still inside the trial window is unlocked;
-- everything else (trial expired, past_due, canceled, incomplete) is locked.
create or replace function public.org_is_locked(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when o.subscription_status = 'active' then false
    when o.subscription_status = 'trialing' and o.trial_ends_at > now() then false
    else true
  end
  from organizations o where o.id = p_org_id;
$$;

-- Attached to deals/stakeholders/deal_tasks -- all three already carry org_id directly, so
-- this one trigger function covers deal creation/editing, stakeholder management, and task
-- management uniformly. Deletes are intentionally not gated -- cleanup (freeing deal-room
-- quota, tidying up) shouldn't be blocked just because a payment lapsed. Document uploads
-- (storage RLS) and every prospect-facing read are untouched -- soft lock is rep-side only.
create or replace function public.enforce_org_not_locked()
returns trigger
language plpgsql
as $$
begin
  if public.org_is_locked(new.org_id) then
    raise exception 'Your plan requires payment to continue editing. Please upgrade to keep making changes.';
  end if;
  return new;
end;
$$;

create trigger enforce_org_not_locked
  before insert or update on deals
  for each row execute function public.enforce_org_not_locked();

create trigger enforce_org_not_locked
  before insert or update on stakeholders
  for each row execute function public.enforce_org_not_locked();

create trigger enforce_org_not_locked
  before insert or update on deal_tasks
  for each row execute function public.enforce_org_not_locked();

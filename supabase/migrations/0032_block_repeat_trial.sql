-- Confirmed with Mark: new signups are never blocked, but an email that has already owned
-- an organization before (i.e. already had a free trial, whether they let it lapse or
-- canceled a subscription) does not get a second free 14-day trial -- their new org is
-- created already outside its trial window, so org_is_locked (0018) locks them immediately
-- and "Upgrade" sends them straight into a real, immediate-charge Stripe checkout (see the
-- matching change in create-checkout-session.mts, which only grants the Early Activation
-- Promo trial when trial_ends_at is still in the future). This closes the
-- signup-cancel-resignup loop without adding any new gate at signup time itself.
create or replace function public.create_organization_with_owner(
  p_org_name text,
  p_full_name text default null,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_slug text;
  v_email text;
  v_returning boolean;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to create an organization';
  end if;

  if exists (select 1 from organization_members where user_id = auth.uid()) then
    raise exception 'User already belongs to an organization';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  -- Case-insensitive: owner_email is stored as auth.users.email gave it to us, and email
  -- addresses are case-insensitive in practice.
  v_returning := exists (
    select 1 from organizations where lower(owner_email) = lower(v_email)
  );

  v_slug := lower(regexp_replace(trim(p_org_name), '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into organizations (name, slug, owner_email, trial_ends_at)
  values (
    trim(p_org_name), v_slug, v_email,
    case when v_returning then now() else now() + interval '14 days' end
  )
  returning id into v_org_id;

  insert into organization_members (org_id, user_id, role)
  values (v_org_id, auth.uid(), 'owner');

  insert into profiles (id, email, full_name, phone)
  values (auth.uid(), v_email, p_full_name, p_phone)
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, profiles.full_name),
    phone = coalesce(excluded.phone, profiles.phone);

  return v_org_id;
end;
$$;

-- Early Activation Promo fix: once a real Stripe subscription exists, its own trial
-- (tracked via current_period_end from the webhook, not organizations.trial_ends_at) is
-- authoritative. Without this, a customer who activates early and is still inside their
-- paid 2-month Stripe trial would get incorrectly locked out the moment their *original*
-- signup trial_ends_at passes, despite having a card on file and owing nothing yet.
create or replace function public.org_is_locked(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when o.subscription_status = 'active' then false
    when o.subscription_status = 'trialing' and o.stripe_subscription_id is not null then false
    when o.subscription_status = 'trialing' and o.trial_ends_at > now() then false
    else true
  end
  from organizations o where o.id = p_org_id;
$$;

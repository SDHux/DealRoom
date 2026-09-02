-- Foundational customer/org tracking (Mark's "be more prepared foundationally" pass).
-- Reconciles with what Stripe billing (0018) already built rather than duplicating it:
-- subscription_status and plan_tier stay exactly as they are, untouched -- both are already
-- live in stripe-webhook.mts / create-checkout-session.mts / app.jsx's lock logic, and
-- renaming them now would mean re-testing an already-working flow for no real benefit.
-- Confirmed with Mark: keep those two as-is; add is_test as a separate, orthogonal column.

-- Denormalized on purpose so it's directly visible in Supabase's Table Editor (Mark's
-- stated workflow for browsing orgs) without a join. Kept in sync at creation time only, by
-- create_organization_with_owner below -- this app has no "transfer ownership" feature yet,
-- so there's no path for it to drift out of sync today.
alter table organizations add column owner_email text;

update organizations o
set owner_email = p.email
from organization_members m
join profiles p on p.id = m.user_id
where m.org_id = o.id and m.role = 'owner' and o.owner_email is null;

-- Distinct from subscription_status by design (confirmed with Mark) -- this is meant to
-- reflect Stripe's own `livemode` flag (true for a test-mode customer/subscription, false
-- for a real one) once the webhook is built, not a manual "looks like a throwaway account"
-- guess baked into a migration. No org has a stripe_customer_id yet, so there is nothing to
-- derive this from automatically right now -- it defaults false, and today's pre-Stripe
-- test/dev accounts can be flagged directly in Table Editor now that the column exists.
alter table organizations add column is_test boolean not null default false;

-- Real DB-level version of "every user belongs to exactly one org" -- today that's only an
-- RPC-level check (create_organization_with_owner / accept_pending_invite both raise/no-op
-- if a membership row already exists), not an actual constraint. A direct org_id column on
-- profiles was considered instead, but that would create a second source of truth that has
-- to be kept in sync with organization_members by hand -- this gets the same guarantee for
-- free, enforced by Postgres itself, with no new column and nothing else to keep in sync.
create unique index organization_members_one_org_per_user
  on organization_members (user_id);

-- Now also records the signup email into organizations.owner_email -- everything else about
-- this function (org/membership creation, the profiles upsert) is unchanged from 0019.
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
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to create an organization';
  end if;

  if exists (select 1 from organization_members where user_id = auth.uid()) then
    raise exception 'User already belongs to an organization';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  v_slug := lower(regexp_replace(trim(p_org_name), '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into organizations (name, slug, owner_email) values (trim(p_org_name), v_slug, v_email)
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

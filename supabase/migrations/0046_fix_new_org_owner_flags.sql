-- Bug found while QA'ing the Team Admin/Manager rework's visual layer with a brand-new
-- signup: create_organization_with_owner (pre-dates 0039) inserts organization_members
-- with only `role='owner'`, never touching is_admin/is_manager -- 0040's backfill only
-- updated the six orgs that already existed at the moment it ran; it never patched this
-- RPC itself. Every org created since 0039/0040 shipped has an owner with BOTH flags
-- false by default.
--
-- This is not just cosmetic: current_org_is_solo(org_id) (0041) keeps a lone owner's own
-- deal visibility safe structurally regardless of these flags, but the instant that owner
-- gets a second member (their first teammate, solo or Team), current_org_is_solo flips to
-- false and current_org_is_manager (is_manager-only) is the only remaining path to see
-- their own deals -- which was false the whole time. A brand-new owner's very first
-- invite would have silently locked them out of their own pipeline. Also blocks the Admin
-- Portal itself (is_admin-gated) and provision-teammate.mts/create-team-checkout-session.mts
-- (both is_admin-gated) for every future Team signup, solo-converted or not.
--
-- Fix mirrors 0040's own mapping for a solo owner: both flags true. A single-member org's
-- owner is necessarily both its Admin and its de facto Manager until it grows.
create or replace function public.create_organization_with_owner(p_org_name text, p_full_name text default null::text, p_phone text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into organization_members (org_id, user_id, role, is_admin, is_manager)
  values (v_org_id, auth.uid(), 'owner', true, true);

  insert into profiles (id, email, full_name, phone)
  values (auth.uid(), v_email, p_full_name, p_phone)
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, profiles.full_name),
    phone = coalesce(excluded.phone, profiles.phone);

  return v_org_id;
end;
$function$;

-- One-row backfill for the gap window between 0040 running and this fix -- confirmed via
-- direct query to be exactly one org (a QA test org from this session), not any real
-- customer signup.
update organization_members
set is_admin = true, is_manager = true
where role = 'owner' and not is_admin and not is_manager;

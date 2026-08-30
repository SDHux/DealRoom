-- Adds a phone number to signup and an audit record of Terms/Privacy acceptance.
-- profiles.phone already exists (0016_profile_fields.sql) -- this just threads it through
-- signup instead of leaving it settable only from the My Profile tab afterward.

-- Audit record of consent (when, not a hard server-side gate -- the required-checkbox UX
-- gate on the signup form itself is the actual enforcement here, unlike the billing lock).
alter table profiles add column terms_accepted_at timestamptz;

-- Adding a parameter changes this function's signature, not a like-for-like replace --
-- CREATE OR REPLACE can't turn a (text,text) function into a (text,text,text) one in place,
-- it would just leave both overloads registered and make PostgREST's call resolution
-- ambiguous. Drop the old one first.
drop function if exists public.create_organization_with_owner(text, text);

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
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to create an organization';
  end if;

  if exists (select 1 from organization_members where user_id = auth.uid()) then
    raise exception 'User already belongs to an organization';
  end if;

  v_slug := lower(regexp_replace(trim(p_org_name), '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into organizations (name, slug) values (trim(p_org_name), v_slug)
  returning id into v_org_id;

  insert into organization_members (org_id, user_id, role)
  values (v_org_id, auth.uid(), 'owner');

  insert into profiles (id, email, full_name, phone)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_full_name, p_phone)
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, profiles.full_name),
    phone = coalesce(excluded.phone, profiles.phone);

  return v_org_id;
end;
$$;

revoke all on function public.create_organization_with_owner(text, text, text) from public;
grant execute on function public.create_organization_with_owner(text, text, text) to authenticated;

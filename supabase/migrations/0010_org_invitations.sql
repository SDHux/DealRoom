-- Pending team invitations. No token/link is generated here on purpose -- the admin just
-- shares the app's normal signup URL out-of-band; a newly-verified signup is matched to a
-- pending row purely by email (see accept_pending_invite() below). That design is exactly
-- why this only works safely once auth.users.email_confirmed_at is trustworthy, i.e. once
-- Authentication > Providers > Email > "Confirm email" is turned ON in the Supabase
-- dashboard. With it off, every signup gets auto-confirmed regardless of who actually
-- controls that inbox, and this table's whole security model falls apart -- someone who
-- merely knows a teammate's email could sign up as them and get auto-joined.

create table org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member')), -- never 'owner', by design
  invited_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id)
);

create index on org_invitations (org_id);
create index on org_invitations (lower(email));

-- At most one live (unaccepted) invite per org+email at a time. Re-inviting after an old
-- invite expired requires deleting the stale row first (the delete policy below already
-- lets owner/admin do that).
create unique index org_invitations_pending_unique
  on org_invitations (org_id, lower(email))
  where accepted_at is null;

alter table org_invitations enable row level security;

-- Mirrors the exact permission matrix org_members_insert/update/delete already use in
-- 0002: owner can invite at any non-owner role; admin can only invite plain members.
create policy org_invitations_select on org_invitations
  for select
  using (current_org_role(org_id) in ('owner', 'admin'));

create policy org_invitations_insert on org_invitations
  for insert
  with check (
    invited_by = auth.uid()
    and (
      current_org_role(org_id) = 'owner'
      or (current_org_role(org_id) = 'admin' and role = 'member')
    )
  );

create policy org_invitations_delete on org_invitations
  for delete
  using (
    current_org_role(org_id) = 'owner'
    or (current_org_role(org_id) = 'admin' and role = 'member')
  );

-- No update policy: invitations are immutable from the client. Acceptance happens only
-- through the SECURITY DEFINER function below, which (like create_organization_with_owner
-- in 0006) runs with the function owner's privileges and needs no grant of its own.
grant select, insert, delete on public.org_invitations to authenticated;

-- Called by a newly-signed-in user with no existing org membership. Returns the org_id
-- they were just added to, or null if there's no matching invite (caller should then fall
-- back to the existing "name your organization" flow, unchanged).
--
-- SECURITY: this function is the entire enforcement point for the invite-acceptance
-- privilege boundary, and it enforces it via email_confirmed_at, NOT via any secret token
-- (there isn't one -- see the header comment on this table). That check is only real
-- protection while Authentication > Providers > Email > "Confirm email" is ON -- with it
-- off, GoTrue sets email_confirmed_at at signup regardless of who actually controls that
-- inbox, and this function would silently auto-join an attacker who merely typed in a
-- teammate's email address. Do not remove this check, and do not rely on it alone without
-- also confirming that dashboard setting is on.
create or replace function public.accept_pending_invite()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_email text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated';
  end if;

  if exists (select 1 from organization_members where user_id = auth.uid()) then
    return null; -- already belongs to an org; nothing to accept
  end if;

  select email, email_confirmed_at into v_email, v_confirmed
  from auth.users where id = auth.uid();

  if v_email is null or v_confirmed is null then
    return null;
  end if;

  select * into v_invite
  from org_invitations
  where lower(email) = lower(v_email)
    and accepted_at is null
    and expires_at > now()
  order by created_at desc
  limit 1
  for update skip locked;

  if v_invite.id is null then
    return null;
  end if;

  insert into organization_members (org_id, user_id, role)
  values (v_invite.org_id, auth.uid(), v_invite.role);

  update org_invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_invite.id;

  insert into profiles (id, email, full_name)
  values (auth.uid(), v_email, null)
  on conflict (id) do nothing;

  return v_invite.org_id;
end;
$$;

revoke all on function public.accept_pending_invite() from public;
grant execute on function public.accept_pending_invite() to authenticated;

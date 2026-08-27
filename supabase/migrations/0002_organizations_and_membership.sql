-- Organizations, user profiles, and org membership with three roles: owner / admin / member.
--
-- Permission model (enforced below via RLS, not just documented):
--   owner  - full access. Manages billing (billing wiring comes in a later step, but this
--            table is where "is this user allowed to touch billing" gets checked from).
--            Exactly one owner per org. Only the owner can remove or demote an admin, or
--            promote someone to admin/owner.
--   admin  - can invite and remove plain members (not other admins, not the owner). Has
--            full read/write access to every deal in the org, same as owner (e.g. to
--            reassign or edit a departed rep's deals -- see deals policies in 0003).
--            Cannot touch billing, cannot delete the org, cannot manage other admins.
--   member - can create deals and manage (edit/delete) their own; can see every other
--            deal in the org too (team-wide visibility by default, nothing is private).
--            No membership-management rights.
-- There is no separate "viewer" role right now.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan_tier text not null default 'trial',
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on organizations
  for each row execute function public.set_updated_at();

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on profiles
  for each row execute function public.set_updated_at();

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index on organization_members (user_id);
create index on organization_members (org_id);

-- Exactly one owner per org.
create unique index organization_members_one_owner_per_org
  on organization_members (org_id)
  where role = 'owner';

-- Helper functions used by every RLS policy from here on. SECURITY DEFINER so they can
-- read organization_members without going through that table's own RLS policies (which
-- would otherwise recurse into these same functions).

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members
    where org_id = p_org_id and user_id = auth.uid()
  );
$$;

create or replace function public.current_org_role(p_org_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.organization_members
  where org_id = p_org_id and user_id = auth.uid();
$$;

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table organization_members enable row level security;

-- organizations: members can read their org; only the owner can update org-level settings
-- (name, slug, plan/billing fields). No insert/delete policy here on purpose — org creation
-- (and the atomic first-owner membership row that goes with it) happens through a
-- SECURITY DEFINER signup function in a later step, not a direct client insert. Org deletion
-- is deliberately left with no policy at all for now (too dangerous for a blanket RLS rule).

create policy organizations_select on organizations
  for select
  using (is_org_member(id));

create policy organizations_update on organizations
  for update
  using (current_org_role(id) = 'owner')
  with check (current_org_role(id) = 'owner');

-- profiles: visible to yourself and anyone who shares an org with you (teammate names/
-- avatars need to render in the UI); only editable by the profile's own owner.

create policy profiles_select on profiles
  for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.organization_members m1
      join public.organization_members m2 on m1.org_id = m2.org_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );

create policy profiles_update_own on profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- organization_members: the actual role-permission matrix.
--   select: any org member can see the roster.
--   insert (invite): owner or admin can invite; only the owner can invite someone in
--     directly as 'owner' or 'admin' — admin can only invite at 'member'.
--   update/delete (role changes, removals): owner can touch any row; admin can only
--     touch rows that are currently 'member' (can't demote/remove another admin or the
--     owner, and can't promote a member past 'member' either — promotion to admin/owner
--     is owner-only).

create policy org_members_select on organization_members
  for select
  using (is_org_member(org_id));

create policy org_members_insert on organization_members
  for insert
  with check (
    current_org_role(org_id) = 'owner'
    or (current_org_role(org_id) = 'admin' and role = 'member')
  );

create policy org_members_update on organization_members
  for update
  using (
    current_org_role(org_id) = 'owner'
    or (current_org_role(org_id) = 'admin' and role = 'member')
  )
  with check (
    current_org_role(org_id) = 'owner'
    or (current_org_role(org_id) = 'admin' and role = 'member')
  );

create policy org_members_delete on organization_members
  for delete
  using (
    current_org_role(org_id) = 'owner'
    or (current_org_role(org_id) = 'admin' and role = 'member')
  );

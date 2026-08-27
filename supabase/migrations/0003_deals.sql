-- Deals: the core org-scoped entity. Everything else in later migrations hangs off this
-- table via (deal_id, org_id) composite FKs.

create table deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,

  company_name text not null,
  primary_contact_name text,
  title text,
  stage text not null default 'Discovery'
    check (stage in ('Discovery', 'Evaluation', 'Trial', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost')),
  value_amount numeric(14, 2),
  currency text not null default 'USD',
  close_date date,
  logo_initials text,
  brand_color text,
  industry text,
  engagement_score smallint check (engagement_score between 0 and 100),
  include_trial_sessions boolean not null default true,
  welcome_message text,

  -- Freeform AI-authored narrative blobs (problem/challenges/solutions, discovery notes,
  -- goals). Nothing in the app queries into individual fields of these, and JSONB
  -- supports partial regeneration (the existing "AI Refresh" flow) without a rewrite.
  exec_summary jsonb not null default '{}'::jsonb,
  discovery jsonb not null default '{}'::jsonb,

  -- Prospect access: two factors. share_slug is a long random token that's part of the
  -- URL; access_code is the short human-shareable code (same UX as today's "KH2026").
  -- Neither is hashed — the rep UI needs to redisplay access_code to copy into an email,
  -- and protection comes from RLS denying all direct anon/authenticated access below,
  -- forcing every prospect read through a single audited SECURITY DEFINER RPC (built in
  -- a later step) rather than from the storage format of a short shared secret.
  share_slug text not null unique,
  access_code text not null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,

  constraint deals_id_org_uniq unique (id, org_id)
);

create index on deals (org_id);
create index on deals (share_slug);

create trigger set_updated_at
  before update on deals
  for each row execute function public.set_updated_at();

-- Populates NEW.org_id from the parent deal, for any child table with a deal_id column.
-- deal_id is nullable on prospect_access_attempts (a failed lookup may not resolve to a
-- deal at all), so this tolerates a null deal_id instead of raising.
create or replace function public.derive_org_id_from_deal()
returns trigger
language plpgsql
as $$
begin
  if new.deal_id is not null then
    select org_id into new.org_id from public.deals where id = new.deal_id;
  end if;
  return new;
end;
$$;

-- Whether the current user can edit/delete a given deal: its own creator, or an org owner
-- (owner has full access per the role model in 0002). Admins and other members do NOT get
-- write access to a deal they didn't create, only read access (see deals_select below) --
-- matches "member: manage their own deals, see everyone else's" and admin's power being
-- team-roster management, not deal-content override.
create or replace function public.can_manage_deal(p_deal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.deals
    where id = p_deal_id
      and (created_by = auth.uid() or current_org_role(org_id) = 'owner')
  );
$$;

alter table deals enable row level security;

-- Team-wide visibility by default: any org member (owner/admin/member) can read every
-- deal in their org, not just their own.
create policy deals_select on deals
  for select
  using (is_org_member(org_id));

-- Any org member can create a deal, and only as themselves (created_by can't be
-- stamped with someone else's user id).
create policy deals_insert on deals
  for insert
  with check (is_org_member(org_id) and created_by = auth.uid());

create policy deals_update on deals
  for update
  using (created_by = auth.uid() or current_org_role(org_id) = 'owner')
  with check (created_by = auth.uid() or current_org_role(org_id) = 'owner');

create policy deals_delete on deals
  for delete
  using (created_by = auth.uid() or current_org_role(org_id) = 'owner');

-- Prospect access sessions/attempts, and the activity/analytics event tables
-- (document_views, deal_visits, deal_visit_actions). These replace the old
-- docsViewed[]/viewers[]/nested activityLog arrays with one real event source each,
-- so view counts and "last viewed" become queries (count/max) instead of stored,
-- driftable state.
--
-- Writes to these tables are NOT expected to come from authenticated client requests --
-- they're populated by the prospect-access RPC and view-tracking calls built in a later
-- step, which run as SECURITY DEFINER and bypass RLS. So these policies are read-only:
-- org members can see their own org's activity, nobody gets an insert/update/delete
-- policy here at all.

create table prospect_sessions (
  id uuid primary key default gen_random_uuid(),
  -- No standalone deal_id FK -- a second relationship path to deals would break
  -- PostgREST's embed disambiguation (see 0004's stakeholders table for the full note).
  deal_id uuid not null,
  org_id uuid not null,
  email text not null,
  authenticated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),

  constraint prospect_sessions_deal_org_fk foreign key (deal_id, org_id) references deals (id, org_id) on delete cascade
);

create index on prospect_sessions (deal_id);

create trigger derive_org_id
  before insert on prospect_sessions
  for each row execute function public.derive_org_id_from_deal();

alter table prospect_sessions enable row level security;

create policy prospect_sessions_select on prospect_sessions
  for select
  using (is_org_member(org_id));

-- deal_id is nullable here: a failed access attempt with a bogus slug may not resolve to
-- any deal at all, and we still want to log the attempt for lockout/rate-limiting.
create table prospect_access_attempts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals (id) on delete cascade,
  org_id uuid,
  email text,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index on prospect_access_attempts (deal_id);

create trigger derive_org_id
  before insert on prospect_access_attempts
  for each row execute function public.derive_org_id_from_deal();

alter table prospect_access_attempts enable row level security;

-- Access-attempt log is more sensitive/operational than regular team data -- restricted
-- to owner/admin rather than every member.
create policy prospect_access_attempts_select on prospect_access_attempts
  for select
  using (org_id is not null and current_org_role(org_id) in ('owner', 'admin'));

create table document_views (
  id uuid primary key default gen_random_uuid(),
  -- No standalone document_id FK -- see the note on stakeholders in 0004.
  document_id uuid not null,
  org_id uuid not null,
  stakeholder_id uuid references stakeholders (id) on delete set null,
  prospect_session_id uuid references prospect_sessions (id) on delete set null,
  viewed_at timestamptz not null default now(),

  constraint document_views_doc_org_fk foreign key (document_id, org_id) references documents (id, org_id) on delete cascade
);

create index on document_views (document_id);
create index on document_views (stakeholder_id);

-- Populates NEW.org_id from the parent document, for document_views specifically
-- (document_views has no deal_id column, so derive_org_id_from_deal doesn't apply here).
create or replace function public.derive_org_id_from_document()
returns trigger
language plpgsql
as $$
begin
  select org_id into new.org_id from public.documents where id = new.document_id;
  return new;
end;
$$;

create trigger derive_org_id
  before insert on document_views
  for each row execute function public.derive_org_id_from_document();

alter table document_views enable row level security;

create policy document_views_select on document_views
  for select
  using (is_org_member(org_id));

create table deal_visits (
  id uuid primary key default gen_random_uuid(),
  -- No standalone deal_id FK -- see the note on stakeholders in 0004.
  deal_id uuid not null,
  org_id uuid not null,
  stakeholder_id uuid references stakeholders (id) on delete set null,
  prospect_session_id uuid references prospect_sessions (id) on delete set null,
  visitor_name text,
  visitor_email text,
  location text,
  started_at timestamptz not null default now(),
  duration_seconds int,
  created_at timestamptz not null default now(),

  constraint deal_visits_deal_org_fk foreign key (deal_id, org_id) references deals (id, org_id) on delete cascade,
  constraint deal_visits_id_org_uniq unique (id, org_id)
);

create index on deal_visits (deal_id);

create trigger derive_org_id
  before insert on deal_visits
  for each row execute function public.derive_org_id_from_deal();

alter table deal_visits enable row level security;

create policy deal_visits_select on deal_visits
  for select
  using (is_org_member(org_id));

create table deal_visit_actions (
  id uuid primary key default gen_random_uuid(),
  -- No standalone visit_id FK -- see the note on stakeholders in 0004.
  visit_id uuid not null,
  org_id uuid not null,
  action_type text not null check (action_type in ('viewed', 'downloaded', 'commented')),
  document_id uuid references documents (id) on delete set null,
  item_label text,
  occurred_at timestamptz not null default now(),

  constraint deal_visit_actions_visit_org_fk foreign key (visit_id, org_id) references deal_visits (id, org_id) on delete cascade
);

create index on deal_visit_actions (visit_id);

-- Populates NEW.org_id from the parent visit, for deal_visit_actions specifically
-- (it has a visit_id, not a deal_id).
create or replace function public.derive_org_id_from_visit()
returns trigger
language plpgsql
as $$
begin
  select org_id into new.org_id from public.deal_visits where id = new.visit_id;
  return new;
end;
$$;

create trigger derive_org_id
  before insert on deal_visit_actions
  for each row execute function public.derive_org_id_from_visit();

alter table deal_visit_actions enable row level security;

create policy deal_visit_actions_select on deal_visit_actions
  for select
  using (is_org_member(org_id));

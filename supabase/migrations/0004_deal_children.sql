-- Direct children of a deal: stakeholders, tasks (the mutual action plan), documents.
-- Same permission shape as deals itself: any org member can read; only the deal's
-- creator or the org owner can write (via can_manage_deal, defined in 0003).

create table stakeholders (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals (id) on delete cascade,
  org_id uuid not null,

  name text not null,
  role_title text,
  designation text check (designation in ('champion', 'decision-maker', 'influencer', 'blocker')),
  engagement_score smallint check (engagement_score between 0 and 100),
  last_seen_at timestamptz,
  business_unit text,
  approval_required boolean not null default false,
  linkedin_url text,
  reports_to uuid,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stakeholders_deal_org_fk foreign key (deal_id, org_id) references deals (id, org_id),
  constraint stakeholders_id_deal_uniq unique (deal_id, id),
  constraint stakeholders_reports_to_fk foreign key (deal_id, reports_to)
    references stakeholders (deal_id, id) on delete set null
);

create index on stakeholders (deal_id);
create index on stakeholders (org_id);

create trigger set_updated_at
  before update on stakeholders
  for each row execute function public.set_updated_at();
create trigger derive_org_id
  before insert on stakeholders
  for each row execute function public.derive_org_id_from_deal();

alter table stakeholders enable row level security;

create policy stakeholders_select on stakeholders
  for select
  using (is_org_member(org_id));

create policy stakeholders_insert on stakeholders
  for insert
  with check (can_manage_deal(deal_id) and created_by = auth.uid());

create policy stakeholders_update on stakeholders
  for update
  using (can_manage_deal(deal_id))
  with check (can_manage_deal(deal_id));

create policy stakeholders_delete on stakeholders
  for delete
  using (can_manage_deal(deal_id));

create table deal_tasks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals (id) on delete cascade,
  org_id uuid not null,

  phase text not null check (phase in ('Value Alignment', 'Trial Sessions', 'Business Case', 'Paper Process')),
  task text not null,
  owner_name text,
  buyer_owner_label text,
  primary_stakeholder_id uuid references stakeholders (id) on delete set null,
  due_date date,
  status text not null default 'pending' check (status in ('complete', 'in-progress', 'pending')),
  notes text,
  approval_required boolean not null default false,
  sort_order int not null default 0,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deal_tasks_deal_org_fk foreign key (deal_id, org_id) references deals (id, org_id)
);

create index on deal_tasks (deal_id);
create index on deal_tasks (org_id);

create trigger set_updated_at
  before update on deal_tasks
  for each row execute function public.set_updated_at();
create trigger derive_org_id
  before insert on deal_tasks
  for each row execute function public.derive_org_id_from_deal();

alter table deal_tasks enable row level security;

create policy deal_tasks_select on deal_tasks
  for select
  using (is_org_member(org_id));

create policy deal_tasks_insert on deal_tasks
  for insert
  with check (can_manage_deal(deal_id) and created_by = auth.uid());

create policy deal_tasks_update on deal_tasks
  for update
  using (can_manage_deal(deal_id))
  with check (can_manage_deal(deal_id));

create policy deal_tasks_delete on deal_tasks
  for delete
  using (can_manage_deal(deal_id));

create table documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals (id) on delete cascade,
  org_id uuid not null,

  title text not null,
  file_type text not null check (file_type in ('pptx', 'xlsx', 'pdf', 'docx', 'link')),
  category text,
  storage_url text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint documents_deal_org_fk foreign key (deal_id, org_id) references deals (id, org_id),
  constraint documents_id_org_uniq unique (id, org_id)
);

create index on documents (deal_id);
create index on documents (org_id);

create trigger set_updated_at
  before update on documents
  for each row execute function public.set_updated_at();
create trigger derive_org_id
  before insert on documents
  for each row execute function public.derive_org_id_from_deal();

alter table documents enable row level security;

create policy documents_select on documents
  for select
  using (is_org_member(org_id));

create policy documents_insert on documents
  for insert
  with check (can_manage_deal(deal_id) and created_by = auth.uid());

create policy documents_update on documents
  for update
  using (can_manage_deal(deal_id))
  with check (can_manage_deal(deal_id));

create policy documents_delete on documents
  for delete
  using (can_manage_deal(deal_id));

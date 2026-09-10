-- Adds a second, independent "post-signature customer journey" sequence to every deal
-- room, alongside the existing close sequence (deal_tasks). Manual, reversible toggle
-- per deal room; frozen (read-only) on whichever side isn't currently in view.

-- active_sequence_view: per-deal, defaults to pre_signature. Every existing deal's one
-- real sequence simply becomes "pre_signature" by definition -- no data migration needed
-- beyond this column default.
alter table deals add column active_sequence_view text not null default 'pre_signature'
  check (active_sequence_view in ('pre_signature', 'post_signature'));

-- Mirrors stage_labels (0024) exactly, for the post-signature stage set.
alter table organizations add column post_signature_stage_labels jsonb not null default '{}'::jsonb;

-- deal_experience_items: separate table (not a discriminator column on deal_tasks), by
-- design -- guarantees every existing deal_tasks read site, especially the MEDDPIC Paper
-- Process line (`deal.mapItems.filter(t=>t.phase==="Paper Process")`, a raw literal match
-- with no sequence-scoping of its own), physically cannot see post-signature rows. Same
-- shape/RLS/triggers as deal_tasks (0004_deal_children.sql). Phase check constraint uses
-- the 5 post-signature default labels as the literal, stable phase values (mirrors how
-- deal_tasks.phase uses "Value Alignment" etc -- distinct from the org-customizable
-- display label held in post_signature_stage_labels).
create table deal_experience_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  org_id uuid not null,

  phase text not null check (phase in ('Kickoff & Intro', 'Requirements', 'Implementation', 'Training', 'Go Live / Activation')),
  task text not null,
  owner_name text,
  buyer_owner_label text,
  primary_stakeholder_id uuid references stakeholders (id) on delete set null,
  due_date date,
  status text not null default 'pending' check (status in ('complete', 'in-progress', 'pending')),
  notes text,
  approval_required boolean not null default false,
  sort_order int not null default 0,
  calendly_enabled boolean not null default false,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deal_experience_items_deal_org_fk foreign key (deal_id, org_id) references deals (id, org_id) on delete cascade
);

create index on deal_experience_items (deal_id);
create index on deal_experience_items (org_id);

create trigger set_updated_at
  before update on deal_experience_items
  for each row execute function public.set_updated_at();
create trigger derive_org_id
  before insert on deal_experience_items
  for each row execute function public.derive_org_id_from_deal();
create trigger enforce_org_not_locked
  before insert or update on deal_experience_items
  for each row execute function public.enforce_org_not_locked();

alter table deal_experience_items enable row level security;

create policy deal_experience_items_select on deal_experience_items
  for select using (is_org_member(org_id));
create policy deal_experience_items_insert on deal_experience_items
  for insert with check (can_manage_deal(deal_id) and created_by = auth.uid());
create policy deal_experience_items_update on deal_experience_items
  for update using (can_manage_deal(deal_id)) with check (can_manage_deal(deal_id));
create policy deal_experience_items_delete on deal_experience_items
  for delete using (can_manage_deal(deal_id));

-- Table-level grant (0007_grants.sql pattern) -- without this every direct client query
-- 403s before RLS is even evaluated.
grant select, insert, update, delete on public.deal_experience_items to authenticated;

-- FREEZE BEHAVIOR: the actual DB-layer gate, not just a disabled UI button. One shared
-- trigger function (TG_ARGV[0] carries which sequence each table belongs to), attached to
-- BOTH deal_tasks and deal_experience_items, covering INSERT, UPDATE, and DELETE.
--
-- Deletes are deliberately included here, unlike enforce_org_not_locked (0018), which
-- exempts deletes so a billing-lapsed org can still free up quota/clean up -- a
-- different policy goal entirely. This feature's whole point is "no data loss, no
-- reset" on the hidden side while it's hidden; an unguarded delete on the frozen
-- sequence would silently violate that guarantee even though the current UI never
-- renders a delete control for it (the inactive sequence isn't rendered at all). The DB
-- has to be the actual gate regardless of what any client sends -- same lesson as the
-- stakeholder-designation visibility gap found earlier.
create or replace function public.enforce_active_sequence()
returns trigger
language plpgsql
as $$
declare
  v_required text := TG_ARGV[0];
  v_deal_id uuid := coalesce(new.deal_id, old.deal_id);
  v_active text;
begin
  select active_sequence_view into v_active from public.deals where id = v_deal_id;
  if v_active is distinct from v_required then
    raise exception 'This deal room is currently showing % — switch back to make changes here.',
      case v_active when 'pre_signature' then 'the Close Sequence' else 'the Post-Signature view' end;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger enforce_active_sequence
  before insert or update or delete on deal_tasks
  for each row execute function public.enforce_active_sequence('pre_signature');

create trigger enforce_active_sequence
  before insert or update or delete on deal_experience_items
  for each row execute function public.enforce_active_sequence('post_signature');

-- get_deal_for_prospect: add deal_experience_items + both stage_labels columns. Also
-- fixes a pre-existing bug (unrelated to this feature, but this function has to be
-- touched anyway and the fix is a prerequisite for this feature's own "prospect sees
-- whichever sequence's real labels" requirement): stage_labels was never returned to
-- prospects at all, so every prospect always saw DEFAULT_STAGE_LABELS regardless of an
-- org's actual renames. active_sequence_view reaches the prospect for free via
-- to_jsonb(d) (it's a plain deals column) -- no explicit line needed for it.
create or replace function public.get_deal_for_prospect(
  p_share_slug text,
  p_access_code text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal record;
  v_session_id uuid;
  v_result jsonb;
begin
  select * into v_deal from deals where share_slug = p_share_slug and archived_at is null;

  if v_deal.id is null then
    insert into prospect_access_attempts (deal_id, org_id, email, succeeded)
    values (null, null, p_email, false);
    return jsonb_build_object('error', 'not_found');
  end if;

  if upper(trim(p_access_code)) is distinct from upper(v_deal.access_code) then
    insert into prospect_access_attempts (deal_id, org_id, email, succeeded)
    values (v_deal.id, v_deal.org_id, p_email, false);
    return jsonb_build_object('error', 'invalid_code');
  end if;

  if auth.uid() is null then
    raise exception 'Anonymous auth session required before calling get_deal_for_prospect (client must call supabase.auth.signInAnonymously() first)';
  end if;

  insert into prospect_sessions (deal_id, org_id, email, user_id)
  values (v_deal.id, v_deal.org_id, p_email, auth.uid())
  returning id into v_session_id;

  insert into prospect_access_attempts (deal_id, org_id, email, succeeded)
  values (v_deal.id, v_deal.org_id, p_email, true);

  select jsonb_build_object(
    'session_id', v_session_id,
    'deal', to_jsonb(d) || jsonb_build_object(
      'stakeholders', coalesce((select jsonb_agg(to_jsonb(s)) from stakeholders s where s.deal_id = d.id), '[]'::jsonb),
      'deal_tasks',   coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from deal_tasks t where t.deal_id = d.id), '[]'::jsonb),
      'deal_experience_items', coalesce((select jsonb_agg(to_jsonb(e) order by e.sort_order) from deal_experience_items e where e.deal_id = d.id), '[]'::jsonb),
      'documents',    coalesce((select jsonb_agg(to_jsonb(doc)) from documents doc where doc.deal_id = d.id), '[]'::jsonb),
      'org_name', (select o.name from organizations o where o.id = d.org_id),
      'stage_labels', (select o.stage_labels from organizations o where o.id = d.org_id),
      'post_signature_stage_labels', (select o.post_signature_stage_labels from organizations o where o.id = d.org_id),
      'rep', (
        select jsonb_build_object(
          'full_name', p.full_name, 'email', p.email, 'avatar_url', p.avatar_url,
          'title', p.title, 'phone', p.phone, 'linkedin_url', p.linkedin_url,
          'calendly_url', p.calendly_url
        )
        from profiles p where p.id = d.created_by
      )
    )
  )
  into v_result
  from deals d where d.id = v_deal.id;

  return v_result;
end;
$$;

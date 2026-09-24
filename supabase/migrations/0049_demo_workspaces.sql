-- Demo workspaces: mybivy.com/?demo=solo|team gives each visitor a private, fully built
-- copy of a sample workspace that lives 8 hours. /api/start-demo (Netlify, service role)
-- creates throwaway auth users, then calls create_demo_workspace() to clone the template
-- (public._demo_template(), generated from demo/content.mjs into 0048). Expired demos are
-- purged by purge_expired_demos() -- lazily on every new demo start, and hourly via pg_cron.

-- 1. Organization flags ------------------------------------------------------------------
alter table public.organizations
  add column if not exists is_demo boolean not null default false,
  add column if not exists demo_kind text check (demo_kind in ('solo', 'team')),
  add column if not exists demo_expires_at timestamptz;

create index if not exists organizations_demo_expiry_idx
  on public.organizations (demo_expires_at) where is_demo;

-- 2. Guard triggers: skip cascaded writes --------------------------------------------------
-- Both guards used to fire on rows Postgres itself touches during a cascade (a parent
-- deal/org delete, or ON DELETE SET NULL clearing a stakeholder reference). That broke
-- real users too: deleting a deal that ever had post-signature items, or removing a
-- stakeholder referenced by a task in the other sequence, raised "switch back to make
-- changes here", and nothing could be deleted from a locked org at all. A direct write is
-- trigger depth 1; anything nested (RI cascades) is deeper and isn't a user edit.
create or replace function public.enforce_active_sequence()
returns trigger language plpgsql as $$
declare
  v_required text := TG_ARGV[0];
  v_deal_id uuid := coalesce(new.deal_id, old.deal_id);
  v_active text;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  select active_sequence_view into v_active from public.deals where id = v_deal_id;
  if v_active is distinct from v_required then
    raise exception 'This deal room is currently showing % — switch back to make changes here.',
      case v_active when 'pre_signature' then 'the Close Sequence' else 'the Post-Signature view' end;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_org_not_locked()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if public.org_is_locked(new.org_id) then
    raise exception 'Your plan requires payment to continue editing. Please upgrade to keep making changes.';
  end if;
  return new;
end;
$$;

-- 3. An expired demo is read-only, same as an expired trial ------------------------------
create or replace function public.org_is_locked(p_org_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case
    when o.is_demo then o.demo_expires_at <= now()
    when o.subscription_status = 'active' then false
    when o.subscription_status = 'trialing' and o.stripe_subscription_id is not null then false
    when o.subscription_status = 'trialing' and o.trial_ends_at > now() then false
    else true
  end
  from organizations o where o.id = p_org_id;
$$;

-- 4. Smaller AI Coach allowance for demo orgs (each demo is a brand-new org) ---------------
create or replace function public.check_and_increment_ai_coach_usage(p_org_id uuid)
returns table(allowed boolean, request_count integer, monthly_cap integer)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_cap int := case when (select o.is_demo from organizations o where o.id = p_org_id) then 25 else 60 end;
  v_month date := date_trunc('month', now())::date;
  v_count int;
begin
  if not is_org_member(p_org_id) then
    raise exception 'Not authorized for this organization''s AI Coach usage';
  end if;

  insert into ai_coach_usage (org_id, period_month, request_count)
  values (p_org_id, v_month, 0)
  on conflict (org_id, period_month) do nothing;

  select ac.request_count into v_count
  from ai_coach_usage ac
  where ac.org_id = p_org_id and ac.period_month = v_month
  for update;

  if v_count >= v_cap then
    return query select false, v_count, v_cap;
    return;
  end if;

  update ai_coach_usage
  set request_count = ai_coach_usage.request_count + 1
  where org_id = p_org_id and period_month = v_month
  returning ai_coach_usage.request_count into v_count;

  return query select true, v_count, v_cap;
end;
$$;

-- 5. Seeding helpers -----------------------------------------------------------------------
-- Offsets in the template are days relative to "now" (fractions allowed).
create or replace function public._demo_ts(p_days numeric)
returns timestamptz language sql stable as $$
  select now() + make_interval(secs => (p_days * 86400)::double precision);
$$;

-- Placeholder until 0048 installs the generated content.
create or replace function public._demo_template()
returns jsonb language sql immutable as $$ select '{}'::jsonb $$;

-- Seeds one deal room from a template entry. p_shared = template's sharedDocs map.
create or replace function public._demo_seed_deal(p_org uuid, p_owner uuid, s jsonb, p_shared jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_deal uuid; v_sid uuid; v_did uuid; v_vid uuid;
  v_sh jsonb := '{}'::jsonb;
  v_docs jsonb := '{}'::jsonb;
  v_doc jsonb; r jsonb; a text;
  v_i int; v_n int; v_start timestamptz;
  v_created numeric := (s->>'createdAgo')::numeric;
begin
  insert into deals (org_id, company_name, primary_contact_name, title, stage, value_amount, close_date,
    logo_initials, brand_color, industry, include_trial_sessions, welcome_message,
    exec_summary, discovery, meddpic, share_slug, access_code,
    created_by, assigned_to, created_at, updated_at, active_sequence_view)
  values (p_org, s->>'company', s->>'contact', s->>'title', s->>'stage', (s->>'value')::numeric,
    current_date + (s->>'closeIn')::int, s->>'logo', s->>'color', s->>'industry',
    coalesce((s->>'trial')::boolean, false), s->>'welcome',
    coalesce(s->'execSummary', '{}'::jsonb), coalesce(s->'discovery', '{}'::jsonb), coalesce(s->'meddpic', '{}'::jsonb),
    trim(both '-' from lower(regexp_replace(s->>'company', '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || substr(md5(gen_random_uuid()::text), 1, 10),
    upper(substr(md5(gen_random_uuid()::text), 1, 6)),
    p_owner, p_owner, _demo_ts(-v_created), now(), 'pre_signature')
  returning id into v_deal;

  -- Stakeholders (template lists managers before their reports, so reports_to resolves).
  for r in select value from jsonb_array_elements(coalesce(s->'stakeholders', '[]'::jsonb)) loop
    insert into stakeholders (deal_id, org_id, name, role_title, designation, engagement_score, last_seen_at,
      business_unit, approval_required, email, reports_to, created_by, created_at, updated_at)
    values (v_deal, p_org, r->>'name', r->>'role', r->>'desig', (r->>'eng')::smallint,
      case when jsonb_typeof(r->'seen') = 'number' then _demo_ts(-(r->>'seen')::numeric) end,
      r->>'bu', coalesce((r->>'approval')::boolean, false), r->>'email',
      (v_sh->>(r->>'reportsTo'))::uuid, p_owner, _demo_ts(-v_created + 1), now())
    returning id into v_sid;
    v_sh := v_sh || jsonb_build_object(r->>'key', v_sid);
  end loop;

  -- Close-sequence tasks. updated_at is set explicitly: deal_risk_signals reads it.
  v_i := 0;
  for r in select value from jsonb_array_elements(coalesce(s->'tasks', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into deal_tasks (deal_id, org_id, phase, task, owner_name, buyer_owner_label, primary_stakeholder_id,
      due_date, status, notes, approval_required, sort_order, calendly_enabled, created_by, created_at, updated_at)
    values (v_deal, p_org, r->>'phase', r->>'task', r->>'owner', r->>'buyer', (v_sh->>(r->>'primary'))::uuid,
      current_date + (r->>'due')::int, r->>'status', r->>'notes', coalesce((r->>'approval')::boolean, false), v_i,
      coalesce((r->>'calendly')::boolean, false), p_owner,
      _demo_ts(-v_created + 0.5), _demo_ts(-(r->>'touched')::numeric));
  end loop;

  -- Documents (a template doc may reference a shared doc by key and override fields).
  for r in select value from jsonb_array_elements(coalesce(s->'docs', '[]'::jsonb)) loop
    v_doc := case when r ? 'shared' then (p_shared->(r->>'shared')) || r else r end;
    insert into documents (deal_id, org_id, title, file_type, category, storage_path, created_by, created_at, updated_at, source)
    values (v_deal, p_org, v_doc->>'title', v_doc->>'type', v_doc->>'cat', v_doc->>'path', p_owner,
      _demo_ts(-(v_doc->>'addedAgo')::numeric), _demo_ts(-(v_doc->>'addedAgo')::numeric), 'rep')
    returning id into v_did;
    v_docs := v_docs || jsonb_build_object(r->>'key', v_did);
  end loop;

  -- Prospect visits -> activity log, plus matching document_views so view counts, the
  -- "last viewed" line, and the buyer-disengaged signal all agree with the log.
  for r in select value from jsonb_array_elements(coalesce(s->'visits', '[]'::jsonb)) loop
    v_start := _demo_ts(-(r->>'ago')::numeric);
    v_sid := (v_sh->>(r->>'who'))::uuid;
    insert into deal_visits (deal_id, org_id, stakeholder_id, visitor_name, visitor_email, location, started_at, duration_seconds, created_at)
    select v_deal, p_org, st.id, st.name, st.email, r->>'loc', v_start, (r->>'dur')::int, v_start
    from stakeholders st where st.id = v_sid
    returning id into v_vid;
    v_n := 0;
    for a in select value from jsonb_array_elements_text(coalesce(r->'views', '[]'::jsonb)) loop
      v_n := v_n + 1;
      v_did := (v_docs->>a)::uuid;
      continue when v_did is null or v_vid is null;
      insert into deal_visit_actions (visit_id, org_id, action_type, document_id, item_label, occurred_at)
      select v_vid, p_org, 'viewed', d.id, d.title, v_start + make_interval(mins => 1 + v_n * 3)
      from documents d where d.id = v_did;
      insert into document_views (document_id, org_id, stakeholder_id, viewed_at)
      values (v_did, p_org, v_sid, v_start + make_interval(mins => 1 + v_n * 3));
    end loop;
  end loop;

  -- Signed deals: flip to the post-signature view, then seed the onboarding plan.
  if s ? 'experience' then
    update deals set active_sequence_view = 'post_signature' where id = v_deal;
    v_i := 0;
    for r in select value from jsonb_array_elements(s->'experience') loop
      v_i := v_i + 1;
      insert into deal_experience_items (deal_id, org_id, phase, task, owner_name, buyer_owner_label, primary_stakeholder_id,
        due_date, status, notes, approval_required, sort_order, calendly_enabled, created_by, created_at, updated_at)
      values (v_deal, p_org, r->>'phase', r->>'task', r->>'owner', r->>'buyer', (v_sh->>(r->>'primary'))::uuid,
        current_date + (r->>'due')::int, r->>'status', r->>'notes', coalesce((r->>'approval')::boolean, false), v_i,
        coalesce((r->>'calendly')::boolean, false), p_owner,
        _demo_ts(-(r->>'touched')::numeric - 1), _demo_ts(-(r->>'touched')::numeric));
    end loop;
  end if;

  return v_deal;
end;
$$;

-- 6. Clone a whole workspace ---------------------------------------------------------------
-- p_owner / p_teammates are auth users /api/start-demo just created (throwaway
-- demo-…@demo.mybivy.com addresses, email pre-confirmed, never mailed).
create or replace function public.create_demo_workspace(p_kind text, p_owner uuid, p_owner_email text, p_teammates uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_t jsonb := public._demo_template();
  v_org uuid; v_owner jsonb; v_mate jsonb; r jsonb; v_i int; v_mates int;
begin
  if p_kind not in ('solo', 'team') then
    raise exception 'Unknown demo kind %', p_kind;
  end if;
  if v_t->'deals' is null then
    raise exception 'Demo template content is not installed';
  end if;
  v_mates := jsonb_array_length(coalesce(v_t->'teammates', '[]'::jsonb));
  if p_kind = 'team' and coalesce(array_length(p_teammates, 1), 0) < v_mates then
    raise exception 'The Team demo needs % teammate accounts', v_mates;
  end if;
  v_owner := v_t->'owner'->p_kind;

  insert into organizations (name, slug, plan_tier, subscription_status, trial_ends_at, owner_email,
    is_test, onboarding_seen, is_demo, demo_kind, demo_expires_at)
  values (v_t->>'orgName', 'demo-' || substr(md5(gen_random_uuid()::text), 1, 12),
    case p_kind when 'team' then 'team_5' else 'trial' end, 'active', now() + interval '8 hours',
    p_owner_email, true, true, true, p_kind, now() + interval '8 hours')
  returning id into v_org;
  -- Every demo starts with five rooms, so leave headroom to create one live (the real Solo
  -- cap is 5). Doesn't touch plan_tier, so set_deal_room_limit_from_plan won't reset it.
  update organizations set deal_room_limit = 10 where id = v_org;

  -- Solo: owner carries both flags, like any real solo org. Team: start in the Manager
  -- view (Team Overview); the demo bar's View-as switcher moves between Admin/Manager/Rep.
  insert into organization_members (org_id, user_id, role, is_admin, is_manager, status)
  values (v_org, p_owner, 'owner', p_kind = 'solo', true, 'active');
  insert into profiles (id, email, full_name, title, phone, terms_accepted_at)
  values (p_owner, v_owner->>'email', v_owner->>'name', v_owner->>'title', v_owner->>'phone', now())
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name,
    title = excluded.title, phone = excluded.phone, terms_accepted_at = excluded.terms_accepted_at;

  if p_kind = 'team' then
    for v_i in 1..v_mates loop
      v_mate := v_t->'teammates'->(v_i - 1);
      insert into organization_members (org_id, user_id, role, is_admin, is_manager, status)
      values (v_org, p_teammates[v_i], 'member', false, false, 'active');
      insert into profiles (id, email, full_name, title, phone, terms_accepted_at)
      values (p_teammates[v_i], v_mate->>'email', v_mate->>'name', v_mate->>'title', v_mate->>'phone', now())
      on conflict (id) do update set email = excluded.email, full_name = excluded.full_name,
        title = excluded.title, phone = excluded.phone;
    end loop;
  end if;

  for r in select value from jsonb_array_elements(v_t->'deals') loop
    perform public._demo_seed_deal(v_org, p_owner, r, v_t->'sharedDocs');
  end loop;
  if p_kind = 'team' then
    for r in select value from jsonb_array_elements(coalesce(v_t->'teamDeals', '[]'::jsonb)) loop
      perform public._demo_seed_deal(v_org, p_teammates[(r->>'rep')::int + 1], r, v_t->'sharedDocs');
    end loop;
  end if;

  return v_org;
end;
$$;

-- 7. Purge ----------------------------------------------------------------------------------
-- Deletes expired demo orgs (everything under them cascades) and their auth users. Only
-- ever touches auth users on the throwaway demo-…@demo.mybivy.com pattern; also sweeps
-- demo users orphaned by a start that failed partway (no membership, over an hour old).
create or replace function public.purge_expired_demos()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_users uuid[];
  v_orgs integer;
begin
  select coalesce(array_agg(m.user_id), '{}') into v_users
  from organization_members m join organizations o on o.id = m.org_id
  where o.is_demo and o.demo_expires_at < now();

  delete from organizations where is_demo and demo_expires_at < now();
  get diagnostics v_orgs = row_count;

  delete from auth.users u
  where u.email like 'demo-%@demo.mybivy.com'
    and not exists (select 1 from organization_members m where m.user_id = u.id)
    and (u.id = any(v_users) or u.created_at < now() - interval '1 hour');

  return v_orgs;
end;
$$;

-- 8. Team demo view switcher ----------------------------------------------------------------
create or replace function public.demo_set_view(p_view text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_view not in ('admin', 'manager', 'rep') then
    raise exception 'Unknown view %', p_view;
  end if;
  update organization_members m
  set is_admin = (p_view = 'admin'), is_manager = (p_view = 'manager')
  from organizations o
  where o.id = m.org_id and o.is_demo and o.demo_kind = 'team'
    and o.demo_expires_at > now() and m.user_id = auth.uid();
  if not found then
    raise exception 'View switching is only available in an active Team demo workspace';
  end if;
end;
$$;

-- 9. Privileges ------------------------------------------------------------------------------
revoke all on function public._demo_ts(numeric) from public, anon, authenticated;
revoke all on function public._demo_template() from public, anon, authenticated;
revoke all on function public._demo_seed_deal(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.create_demo_workspace(text, uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.purge_expired_demos() from public, anon, authenticated;
grant execute on function public._demo_ts(numeric) to service_role;
grant execute on function public._demo_template() to service_role;
grant execute on function public._demo_seed_deal(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.create_demo_workspace(text, uuid, text, uuid[]) to service_role;
grant execute on function public.purge_expired_demos() to service_role;
revoke all on function public.demo_set_view(text) from public, anon;
grant execute on function public.demo_set_view(text) to authenticated;

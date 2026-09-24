-- Past-day demo visits land in the viewer's local business hours (8:00-17:00) instead of
-- "exactly N days before the demo started" (which put buyers in the room at 3 a.m.).
-- Same-day visits (< 1 day ago) stay exact so "2h ago" activity still reads as live.
create or replace function public._demo_visit_ts(p_ago numeric, p_tz text)
returns timestamptz language sql stable as $$
  select case
    when p_ago < 1 then now() - make_interval(secs => (p_ago * 86400)::double precision)
    else ((date_trunc('day', now() at time zone p_tz) - make_interval(days => floor(p_ago)::int))
          + make_interval(mins => (480 + (p_ago - floor(p_ago)) * 540)::int)) at time zone p_tz
  end;
$$;
revoke all on function public._demo_visit_ts(numeric, text) from public, anon, authenticated;

drop function if exists public._demo_seed_deal(uuid, uuid, jsonb, jsonb);
create or replace function public._demo_seed_deal(p_org uuid, p_owner uuid, s jsonb, p_shared jsonb, p_tz text default 'America/Los_Angeles')
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

  for r in select value from jsonb_array_elements(coalesce(s->'stakeholders', '[]'::jsonb)) loop
    insert into stakeholders (deal_id, org_id, name, role_title, designation, engagement_score, last_seen_at,
      business_unit, approval_required, email, reports_to, created_by, created_at, updated_at)
    values (v_deal, p_org, r->>'name', r->>'role', r->>'desig', (r->>'eng')::smallint,
      case when jsonb_typeof(r->'seen') = 'number' then _demo_visit_ts((r->>'seen')::numeric, p_tz) end,
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
    v_start := _demo_visit_ts((r->>'ago')::numeric, p_tz);
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
revoke all on function public._demo_seed_deal(uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public._demo_seed_deal(uuid, uuid, jsonb, jsonb, text) to service_role;

-- create_demo_workspace: accept the viewer's IANA timezone (falls back to Pacific).
drop function if exists public.create_demo_workspace(text, uuid, text, jsonb, uuid[]);
create or replace function public.create_demo_workspace(p_kind text, p_owner uuid, p_owner_email text, p_template jsonb, p_teammates uuid[] default '{}', p_tz text default 'America/Los_Angeles')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_t jsonb := p_template;
  v_tz text := case when exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else 'America/Los_Angeles' end;
  v_org uuid; v_owner jsonb; v_mate jsonb; r jsonb; v_i int; v_mates int;
begin
  if p_kind not in ('solo', 'team') then
    raise exception 'Unknown demo kind %', p_kind;
  end if;
  if v_t->'deals' is null then
    raise exception 'Demo template is missing its deals';
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
  -- Every demo starts with five rooms; leave headroom to create one live (real Solo cap is
  -- 5). Doesn't touch plan_tier, so set_deal_room_limit_from_plan won't reset it.
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
    perform public._demo_seed_deal(v_org, p_owner, r, v_t->'sharedDocs', v_tz);
  end loop;
  if p_kind = 'team' then
    for r in select value from jsonb_array_elements(coalesce(v_t->'teamDeals', '[]'::jsonb)) loop
      perform public._demo_seed_deal(v_org, p_teammates[(r->>'rep')::int + 1], r, v_t->'sharedDocs', v_tz);
    end loop;
  end if;

  return v_org;
end;
$$;
revoke all on function public.create_demo_workspace(text, uuid, text, jsonb, uuid[], text) from public, anon, authenticated;
grant execute on function public.create_demo_workspace(text, uuid, text, jsonb, uuid[], text) to service_role;

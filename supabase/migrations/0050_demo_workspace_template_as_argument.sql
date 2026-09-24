drop function if exists public.create_demo_workspace(text, uuid, text, uuid[]);
drop function if exists public._demo_template();

-- Template content now ships with the Netlify function (demo/template.json, generated from
-- demo/content.mjs) and is passed in, so editing demo content needs a deploy, not a migration.
create or replace function public.create_demo_workspace(p_kind text, p_owner uuid, p_owner_email text, p_template jsonb, p_teammates uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_t jsonb := p_template;
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

revoke all on function public.create_demo_workspace(text, uuid, text, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.create_demo_workspace(text, uuid, text, jsonb, uuid[]) to service_role;

-- Two SECURITY DEFINER entry points the client calls directly (via supabase.rpc), plus a
-- read-only view for document view stats. Both RPCs exist because the alternative --
-- granting broader direct-table INSERT/SELECT policies to make these flows work -- would
-- open a much wider hole than one narrow, audited function each.

-- Signup: creates the org + first (owner) membership + profile row atomically. Nothing
-- else in this schema ever populates `profiles` (0002 only created the table), so this is
-- also where that gap gets closed.
create or replace function public.create_organization_with_owner(
  p_org_name text,
  p_full_name text default null
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

  insert into profiles (id, email, full_name)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_full_name)
  on conflict (id) do update set full_name = coalesce(excluded.full_name, profiles.full_name);

  return v_org_id;
end;
$$;

revoke all on function public.create_organization_with_owner(text, text) from public;
grant execute on function public.create_organization_with_owner(text, text) to authenticated;

-- Prospect access: the only path an unauthenticated buyer has into deal data. Looks up by
-- share_slug (the unguessable part of the link), checks access_code case-insensitively
-- (matching today's client-side UX), logs every attempt -- success or failure -- to
-- prospect_access_attempts, and on success writes a prospect_sessions row and returns the
-- deal with its stakeholders/tasks/documents nested in one JSON blob. That nesting isn't
-- an optimization, it's required: none of those tables have any anon-accessible SELECT
-- policy, so a prospect (who is never an org member) has no RLS path to a follow-up query
-- even with the deal id in hand. This function is the one audited crossing point.
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

  insert into prospect_sessions (deal_id, org_id, email)
  values (v_deal.id, v_deal.org_id, p_email)
  returning id into v_session_id;

  insert into prospect_access_attempts (deal_id, org_id, email, succeeded)
  values (v_deal.id, v_deal.org_id, p_email, true);

  select jsonb_build_object(
    'session_id', v_session_id,
    'deal', to_jsonb(d) || jsonb_build_object(
      'stakeholders', coalesce((select jsonb_agg(to_jsonb(s)) from stakeholders s where s.deal_id = d.id), '[]'::jsonb),
      'deal_tasks',   coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from deal_tasks t where t.deal_id = d.id), '[]'::jsonb),
      'documents',    coalesce((select jsonb_agg(to_jsonb(doc)) from documents doc where doc.deal_id = d.id), '[]'::jsonb)
    )
  )
  into v_result
  from deals d where d.id = v_deal.id;

  return v_result;
end;
$$;

revoke all on function public.get_deal_for_prospect(text, text, text) from public;
grant execute on function public.get_deal_for_prospect(text, text, text) to anon, authenticated;

-- Document view counts / last-viewed, derived from document_views instead of stored,
-- driftable columns. security_invoker so this still honors document_views' own org-scoped
-- RLS (org members only) instead of running with the view owner's privileges.
create view public.document_view_stats
with (security_invoker = true) as
select
  dv.document_id,
  count(*)::int as view_count,
  max(dv.viewed_at) as last_viewed_at,
  array_agg(distinct coalesce(s.name, ps.email))
    filter (where coalesce(s.name, ps.email) is not null) as viewer_names,
  (array_agg(coalesce(s.name, ps.email) order by dv.viewed_at desc))[1] as last_viewer_name
from document_views dv
left join stakeholders s on s.id = dv.stakeholder_id
left join prospect_sessions ps on ps.id = dv.prospect_session_id
group by dv.document_id;

-- Found during a self-review of the TEAM-VERSION-ADMIN-MANAGER-SPEC.md build: the
-- prospect-facing "rep" card (name/photo/title/phone/Calendly link, shown on the
-- prospect's Welcome screen and "Schedule this" buttons) was still resolved from
-- d.created_by in get_deal_for_prospect (0028), never updated when assigned_to was
-- introduced (0033). Reassigning a deal to a different rep -- the whole point of this
-- feature -- silently left the prospect still seeing and booking time with the
-- ORIGINAL rep. Same fix applied client-side to the rep's own view (app.jsx's
-- repProfile, in the main org-load effect).
--
-- coalesce(d.assigned_to, d.created_by) rather than a bare d.assigned_to: every deal has
-- assigned_to set (backfilled + defaulted at insert since 0033), but this stays
-- defensive in the one edge case where it could be null (the assigned user's auth.users
-- row was deleted, ON DELETE SET NULL) -- falls back to at least showing someone rather
-- than no rep card at all.
--
-- Everything else in this function is unchanged from 0028 -- create or replace to touch
-- only the one subquery.
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
        from profiles p where p.id = coalesce(d.assigned_to, d.created_by)
      )
    )
  )
  into v_result
  from deals d where d.id = v_deal.id;

  return v_result;
end;
$$;

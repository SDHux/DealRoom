-- Calendly scheduling link (mirrors linkedin_url, 0016) -- optional, shown as a "Schedule a
-- call" button on the prospect-facing Welcome tab only when a rep has set one.
alter table profiles add column calendly_url text;

-- get_deal_for_prospect's `rep` object is a hand-built jsonb_build_object, not to_jsonb(p),
-- so calendly_url needs to be added explicitly -- unlike the documents/deal columns below,
-- which ride along automatically via to_jsonb(doc).
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
      'documents',    coalesce((select jsonb_agg(to_jsonb(doc)) from documents doc where doc.deal_id = d.id), '[]'::jsonb),
      'org_name', (select o.name from organizations o where o.id = d.org_id),
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

-- Google Workspace (Slides/Docs/Sheets) embeds. is_embed distinguishes these from uploaded
-- files; embed_url holds the converted viewer URL (embed rows leave storage_path null --
-- there's no bucket object for them). No file_type constraint change needed: Slides/Docs/
-- Sheets map onto the existing pptx/docx/xlsx values, so embed rows reuse the exact same
-- FILE_ICON entries the client already has for uploaded files of those types.
alter table documents add column is_embed boolean not null default false;
alter table documents add column embed_url text;

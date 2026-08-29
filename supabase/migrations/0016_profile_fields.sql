-- Fixes a real multi-tenant correctness bug: the app's sidebar and prospect-facing
-- Welcome tab were showing a hardcoded AE constant (one person's name/title/company/
-- email/phone/LinkedIn/photo) to every rep and every prospect regardless of org. This
-- gives every user a real profile instead.

-- title/phone/linkedin_url have no home in the schema yet; full_name/email/avatar_url
-- already exist (0002).
alter table profiles add column title text;
alter table profiles add column phone text;
alter table profiles add column linkedin_url text;

-- Public bucket, self-scoped (not owner/admin-scoped like org-logos, 0011) -- path
-- convention {user_id}/avatar. Public because prospects need to render it without a
-- signed-URL round trip, same reasoning as org-logos.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy avatars_select on storage.objects
  for select to public
  using (bucket_id = 'avatars');

-- get_deal_for_prospect (0006, updated 0012): a real prospect has no org membership, so
-- profiles' own RLS (self or same-org) would block a direct read of the rep's profile --
-- same reasoning as everything else prospect-facing in this app, the fix is embedding it
-- in this already-trusted SECURITY DEFINER response instead of a second direct read.
-- Adds `rep` (the deal creator's profile) and `org_name` to the returned JSON; the deal
-- payload itself and every other behavior is unchanged from the 0012 version.
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
          'title', p.title, 'phone', p.phone, 'linkedin_url', p.linkedin_url
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

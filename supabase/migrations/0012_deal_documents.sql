-- Real document storage: a private per-deal bucket, storage_path instead of a permanent
-- URL, and the identity link (prospect_sessions.user_id) that lets a verified anonymous
-- prospect's Storage RLS check succeed. The client must call
-- supabase.auth.signInAnonymously() BEFORE calling get_deal_for_prospect so auth.uid() is
-- already populated when this function runs, letting it record that identity in the same
-- transaction as the access-code check.
--
-- PREREQUISITE (dashboard, not SQL): Authentication > Providers > Anonymous Sign-ins must
-- be turned ON, same category of manual dependency as "Confirm email" in
-- 0010_org_invitations.sql. Without it, supabase.auth.signInAnonymously() fails outright
-- and no prospect can ever satisfy is_verified_prospect() below.
--
-- Anonymous sign-in makes the caller's Postgres role `authenticated` -- same role real
-- users get -- and 0007_grants.sql already grants that role blanket table access. This is
-- safe: every existing RLS policy on deals/stakeholders/deal_tasks/documents is keyed off
-- is_org_member/current_org_role, which check organization_members for a matching row. An
-- anonymous prospect has none, so none of that access opens up. The only new door is the
-- one this migration deliberately adds below.

-- documents: storage_url was always "#" in practice (no upload path ever existed) --
-- rename to storage_path and store a bucket-relative path, minting signed URLs on demand
-- instead of a permanent public URL (this bucket is private, unlike org-logos).
alter table documents rename column storage_url to storage_path;
update documents set storage_path = null where storage_path = '#';

-- Widen file_type to cover images (spec: "PDFs, docs, slides, images"). 'link' stays for a
-- possible future external-URL document type -- for those rows storage_path would hold the
-- literal external URL rather than a bucket path, and the client opens it directly instead
-- of minting a signed URL.
alter table documents drop constraint documents_file_type_check;
alter table documents add constraint documents_file_type_check
  check (file_type in ('pptx', 'xlsx', 'pdf', 'docx', 'image', 'link'));

-- Distinguishes rep-uploaded from (future) buyer-uploaded documents without requiring a
-- later migration when the buyer-upload step adds that RPC.
alter table documents add column source text not null default 'rep' check (source in ('rep', 'prospect'));

-- prospect_sessions: the durable identity link. Nullable because any rows written before
-- this migration have no anonymous auth.uid() to attach.
alter table prospect_sessions add column user_id uuid references auth.users (id) on delete cascade;
create index on prospect_sessions (deal_id, user_id);

-- Whether the calling request is a verified prospect for this specific deal: a live,
-- unexpired prospect_sessions row links their auth.uid() to p_deal_id. This is what
-- actually enforces the 30-day boundary -- not the anonymous JWT's own lifetime, which
-- supabase-js will happily keep refreshing indefinitely as long as localStorage persists.
create or replace function public.is_verified_prospect(p_deal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.prospect_sessions
    where deal_id = p_deal_id
      and user_id = auth.uid()
      and expires_at > now()
  );
$$;

-- get_deal_for_prospect: same signature as 0006 (create or replace preserves its existing
-- revoke/grant), now recording the caller's auth.uid() -- which only exists because the
-- client signed in anonymously before calling this -- against the deal they just passed
-- the access-code check for.
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
      'documents',    coalesce((select jsonb_agg(to_jsonb(doc)) from documents doc where doc.deal_id = d.id), '[]'::jsonb)
    )
  )
  into v_result
  from deals d where d.id = v_deal.id;

  return v_result;
end;
$$;

-- Bucket: private, path convention {org_id}/{deal_id}/{uuid}-{filename}. 25MB cap;
-- allowlist covers PDFs, Word/PowerPoint/Excel (legacy + OOXML), and common image
-- formats. No executable MIME type is in this list -- the allowlist itself is the real
-- enforcement (Supabase checks the declared Content-Type against this column on every
-- upload), not a denylist of "bad" types.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-documents',
  'deal-documents',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]
)
on conflict (id) do nothing;

-- storage.objects RLS, same shape as org_logos_* in 0011. (storage.foldername(name))[1] is
-- the org_id folder segment (readability only -- not itself a security boundary, since
-- can_manage_deal/is_verified_prospect look up the deal's real org internally regardless
-- of what a client puts in this segment); [2] is the deal_id segment, which IS the actual
-- authorization key for every policy below.
create policy deal_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'deal-documents'
    and (
      can_manage_deal(((storage.foldername(name))[2])::uuid)
      or is_verified_prospect(((storage.foldername(name))[2])::uuid)
    )
  );

create policy deal_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deal-documents'
    and (
      is_org_member(((storage.foldername(name))[1])::uuid)
      or is_verified_prospect(((storage.foldername(name))[2])::uuid)
    )
  );

create policy deal_documents_update on storage.objects
  for update to authenticated
  using (bucket_id = 'deal-documents' and can_manage_deal(((storage.foldername(name))[2])::uuid))
  with check (bucket_id = 'deal-documents' and can_manage_deal(((storage.foldername(name))[2])::uuid));

create policy deal_documents_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'deal-documents' and can_manage_deal(((storage.foldername(name))[2])::uuid));

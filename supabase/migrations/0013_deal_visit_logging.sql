-- Real visit/document-view event logging (spec section 2). document_views, deal_visits,
-- and deal_visit_actions (0005) have had select-only RLS since they were created --
-- that migration's own header comment defers the write path to "the prospect-access RPC
-- and view-tracking calls built in a later step." This is that step: three narrow
-- SECURITY DEFINER RPCs that let a verified prospect log their own visit and document
-- views, reusing is_verified_prospect (0012) as the trust boundary end to end, exactly
-- like the deal-documents storage policies already do.

-- Lets a visit resolve to a real stakeholder name instead of just the prospect's login
-- email. Nullable/non-breaking -- nothing in the current stakeholder create/edit UI
-- populates this yet, so most visits will fall back to the login email (see
-- start_deal_visit below) until a later change adds an email field to that UI.
alter table stakeholders add column email text;
create index on stakeholders (deal_id, lower(email));

-- is_verified_prospect (0012) only proves "this caller is a live prospect for this deal"
-- -- not enough once a single share link, since two different prospect emails on the same
-- link would both pass that check. This narrows to "this specific visit belongs to this
-- authenticated prospect," via the same prospect_sessions.user_id = auth.uid() check.
create or replace function public.owns_deal_visit(p_visit_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.deal_visits v
    join public.prospect_sessions ps on ps.id = v.prospect_session_id
    where v.id = p_visit_id and ps.user_id = auth.uid() and ps.expires_at > now()
  );
$$;

-- Starts one deal_visits row per authenticated prospect browser session. location is
-- never set (real IP geolocation is explicitly deferred); org_id is filled by the
-- existing derive_org_id_from_deal trigger (0005), not set here.
create or replace function public.start_deal_visit(p_deal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_email text;
  v_stakeholder_id uuid;
  v_stakeholder_name text;
  v_visit_id uuid;
begin
  if not is_verified_prospect(p_deal_id) then
    raise exception 'Not a verified prospect for this deal';
  end if;

  select id, email into v_session_id, v_email
  from prospect_sessions
  where deal_id = p_deal_id and user_id = auth.uid() and expires_at > now()
  order by authenticated_at desc limit 1;

  select id, name into v_stakeholder_id, v_stakeholder_name
  from stakeholders
  where deal_id = p_deal_id and email is not null and lower(email) = lower(v_email)
  limit 1;

  insert into deal_visits (deal_id, stakeholder_id, prospect_session_id, visitor_name, visitor_email, started_at)
  values (p_deal_id, v_stakeholder_id, v_session_id, coalesce(v_stakeholder_name, v_email), v_email, now())
  returning id into v_visit_id;

  return v_visit_id;
end;
$$;

revoke all on function public.start_deal_visit(uuid) from public;
grant execute on function public.start_deal_visit(uuid) to authenticated;

-- One action type only ('viewed') -- distinguishing downloaded-vs-viewed is explicitly
-- deferred. item_label is resolved server-side from documents.title rather than trusted
-- from the client. Writes deal_visit_actions and document_views together since, for this
-- feature, one document open always means both a timeline entry and an aggregate-stats
-- row. Returns visitor_name so the client can optimistically update the view count
-- without a second round trip.
create or replace function public.log_document_view(p_visit_id uuid, p_document_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit record;
  v_doc record;
begin
  if not owns_deal_visit(p_visit_id) then
    raise exception 'Not authorized for this visit';
  end if;

  select * into v_visit from deal_visits where id = p_visit_id;
  select * into v_doc from documents where id = p_document_id and deal_id = v_visit.deal_id;
  if v_doc.id is null then
    raise exception 'Document not found on this deal';
  end if;

  insert into deal_visit_actions (visit_id, action_type, document_id, item_label, occurred_at)
  values (p_visit_id, 'viewed', p_document_id, v_doc.title, now());

  insert into document_views (document_id, stakeholder_id, prospect_session_id, viewed_at)
  values (p_document_id, v_visit.stakeholder_id, v_visit.prospect_session_id, now());

  return v_visit.visitor_name;
end;
$$;

revoke all on function public.log_document_view(uuid, uuid) from public;
grant execute on function public.log_document_view(uuid, uuid) to authenticated;

-- Called repeatedly from a client-side heartbeat while the prospect's tab is visible.
-- Overwrites (does not accumulate) duration_seconds, clamped server-side to
-- [0, now()-started_at] so a tampered client value can never record an impossible
-- duration.
create or replace function public.update_deal_visit_duration(p_visit_id uuid, p_duration_seconds int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_at timestamptz;
begin
  if not owns_deal_visit(p_visit_id) then
    raise exception 'Not authorized for this visit';
  end if;

  select started_at into v_started_at from deal_visits where id = p_visit_id;
  update deal_visits
  set duration_seconds = greatest(0, least(p_duration_seconds, extract(epoch from (now() - v_started_at))::int))
  where id = p_visit_id;
end;
$$;

revoke all on function public.update_deal_visit_duration(uuid, int) from public;
grant execute on function public.update_deal_visit_duration(uuid, int) to authenticated;

-- All three grants are `to authenticated` only, not `anon` -- by the time any of them can
-- pass their own is_verified_prospect/owns_deal_visit check, signInAnonymously() must
-- already have run (making the Postgres role `authenticated`, per 0012's own note), so the
-- tighter grant is correct here (unlike get_deal_for_prospect, which must also grant to
-- anon since it's the very first call in the flow).

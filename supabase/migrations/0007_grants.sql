-- Baseline table-level GRANTs for the `authenticated` role.
--
-- RLS policies (0002-0005) control which ROWS a role can see/touch, but Postgres checks
-- table-level GRANTs first -- without them, every query from the app fails with
-- "permission denied for table X" before RLS is ever evaluated. Supabase's dashboard
-- Table Editor applies these automatically when you create a table through it; creating
-- tables via raw SQL in the SQL Editor (what all of these migrations do) does not. The
-- SECURITY DEFINER RPCs in 0006 worked despite this gap because they run with the
-- function owner's privileges, bypassing grants entirely -- which is exactly why this
-- was invisible until the app tried a direct client-side table query.
--
-- No grants to `anon` here on purpose: anon has zero direct table access by design --
-- the only door for an unauthenticated prospect is the get_deal_for_prospect RPC (0006),
-- which (like the signup RPC) runs as SECURITY DEFINER and doesn't need a grant either.

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update, delete on public.deals to authenticated;
grant select, insert, update, delete on public.stakeholders to authenticated;
grant select, insert, update, delete on public.deal_tasks to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_views to authenticated;
grant select, insert, update, delete on public.deal_visits to authenticated;
grant select, insert, update, delete on public.deal_visit_actions to authenticated;
grant select, insert, update, delete on public.prospect_sessions to authenticated;
grant select, insert, update, delete on public.prospect_access_attempts to authenticated;

-- View: select only, no insert/update/delete on a view.
grant select on public.document_view_stats to authenticated;

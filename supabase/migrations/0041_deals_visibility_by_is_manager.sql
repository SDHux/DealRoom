-- Team Admin/Manager Rework, Data model #4: replaces every deal-content policy/function
-- that currently checks current_org_role(org_id) in ('owner','admin') with one that checks
-- current_org_is_manager(org_id) (0039, is_manager only) -- Admin no longer implies deal
-- visibility ANYWHERE, matching this rework's whole premise. Four things needed updating
-- for that to actually be consistent, not just deals_select itself:
--   1. deals_select (0035's version)
--   2. can_manage_deal / can_view_deal (0036's versions -- these gate every deals-adjacent
--      child table: stakeholders, deal_tasks, documents, deal_experience_items,
--      prospect_sessions, deal_visits, document_views, deal_visit_actions, and the
--      deal-documents storage policy. Leaving these on the old role check would have meant
--      Admin still saw every deal's stakeholders/tasks/documents even after losing deals_select
--      visibility -- an inconsistent, incomplete fix.
--   3. deal_assignment_history_select (0034) -- reveals deal_id + who it moved to/from,
--      which is exactly "which specific bivys moved" that Admin's blind reassignment is
--      built to keep hidden from them (spec: Admin's blind reassign RPC returns only a
--      count). This needed the same correction, not just Manager-facing screens.
-- can_manage_deal also drops its owner/admin-implies-write-access clause here, not just
-- read: per the spec, Admin's only deal-touching action is the blind-reassign RPC (0043,
-- security definer, bypasses RLS by design) -- Admin's own client-level session should have
-- neither read nor write access to individual deal rows.
--
-- ROLLBACK (recreate the 0033-0036 versions if this needs to be backed out):
--
--   create or replace function public.can_manage_deal(p_deal_id uuid) returns boolean
--   language sql security definer set search_path = public stable as $$
--     select exists (select 1 from public.deals where id = p_deal_id
--       and (assigned_to = auth.uid() or current_org_role(org_id) in ('owner','admin'))); $$;
--   create or replace function public.can_view_deal(p_deal_id uuid) returns boolean
--   language sql security definer set search_path = public stable as $$
--     select exists (select 1 from public.deals where id = p_deal_id
--       and (assigned_to = auth.uid() or current_org_role(org_id) in ('owner','admin'))); $$;
--   drop policy deals_select on deals;
--   create policy deals_select on deals for select using (
--     current_org_role(org_id) in ('owner','admin') or assigned_to = auth.uid());
--   drop policy deal_assignment_history_select on deal_assignment_history;
--   create policy deal_assignment_history_select on deal_assignment_history for select
--     using (current_org_role(org_id) in ('owner','admin'));

-- Structural solo-org guarantee, same invariant style as 0035's own guardrail: a one-person
-- org's sole member sees 100% of their own deals regardless of how is_admin/is_manager got
-- set on that single row. This is a backstop IN ADDITION to 0040 correctly setting
-- is_manager = true for every solo owner today -- not a replacement for getting that right --
-- so a future signup/migration path that forgets to set the flag can't silently regress
-- Solo again. Extended below to can_manage_deal/can_view_deal too (not just deals_select),
-- so the guarantee holds for every deal-content touchpoint, not only the base table.
-- Named/scoped as "am I this org's sole member," not "does this org happen to have one
-- member" -- checks auth.uid() itself rather than leaving every call site responsible for
-- separately AND-ing in is_org_member(org_id). A helper that only checked org size, without
-- confirming the caller belongs to that org at all, would let any authenticated user pass
-- it for someone ELSE's solo org.
create or replace function public.current_org_is_solo(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members
    where org_id = p_org_id and user_id = auth.uid()
  )
  and (select count(*) from public.organization_members where org_id = p_org_id) = 1
$$;

drop policy deals_select on deals;
create policy deals_select on deals
  for select
  using (
    current_org_is_manager(org_id)
    or assigned_to = auth.uid()
    or current_org_is_solo(org_id)
  );

-- Same structural solo-org backstop as deals_select above, extended to the child-table
-- gate: a solo org's sole member manages/views their own deal's stakeholders/tasks/
-- documents/etc. regardless of flag state, not only conditional on 0040 having set
-- is_manager correctly.
create or replace function public.can_manage_deal(p_deal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.deals
    where id = p_deal_id
      and (
        assigned_to = auth.uid()
        or current_org_is_manager(org_id)
        or current_org_is_solo(org_id)
      )
  );
$$;

create or replace function public.can_view_deal(p_deal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.deals
    where id = p_deal_id
      and (
        assigned_to = auth.uid()
        or current_org_is_manager(org_id)
        or current_org_is_solo(org_id)
      )
  );
$$;

drop policy deal_assignment_history_select on deal_assignment_history;
create policy deal_assignment_history_select on deal_assignment_history
  for select
  using (current_org_is_manager(org_id));

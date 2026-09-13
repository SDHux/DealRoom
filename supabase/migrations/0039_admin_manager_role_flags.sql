-- Team Admin/Manager Rework (team-admin-manager-rework-spec.md), Data model #2.
-- Two independent capability flags, not a third role value bolted onto `role` -- a single
-- owner/admin/member enum can't cleanly express "Admin who is also functionally acting as
-- Manager" without a fourth combined value or a lie. `role` itself is NOT retired: it stays
-- the field org_members_insert/update/delete, the org_invitations policies, and
-- current_org_role() key off (none of those are part of this rework), so nothing about
-- account/org administration changes here -- only deal-content visibility, which moves
-- onto these two new flags.
alter table organization_members add column is_admin boolean not null default false;
alter table organization_members add column is_manager boolean not null default false;

-- The single new authority for "can this person see deal content" -- deliberately checks
-- is_manager ONLY, not is_admin. That asymmetry is the entire point of this rework: Admin
-- should never see deal names, values, stages, or mapping completeness anywhere, which is
-- exactly why "View as Manager" (spec: Decisions #2) has to set real is_manager = true on
-- the Admin's own row rather than being a client-side toggle -- without a real flag flip,
-- this function would still correctly deny them.
create or replace function public.current_org_is_manager(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members
    where org_id = p_org_id and user_id = auth.uid() and is_manager
  );
$$;

-- Deactivation status (Data model #6): reps need to be turned off without deleting their
-- deal_assignment_history trail (0034) or the auth relationship itself, so this is a status
-- column, not a delete. 'invited' now also covers "account/bivy provisioned, hasn't
-- completed first login yet" under the new invite flow (Data model #1), not just the old
-- org_invitations pending-row meaning.
alter table organization_members add column status text not null default 'active'
  check (status in ('active', 'invited', 'deactivated'));

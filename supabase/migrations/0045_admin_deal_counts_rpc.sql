-- Team Admin/Manager Rework, visual layer bugfix found while building AdminPortalScreen:
-- deals_select (0041) is `current_org_is_manager(org_id) OR assigned_to = auth.uid() OR
-- current_org_is_solo(org_id)` -- a real Admin (is_admin true, is_manager false) satisfies
-- none of these for a teammate's deals, so a plain `select assigned_to from deals` (even a
-- head-only count) silently returns zero rows for every rep. That's not a narrow visual
-- bug: the roster's "N bivys" count and the deactivation modal's successor-picker gate both
-- depend on this number, so every real (non-impersonating) Admin session would show every
-- rep as having 0 bivys and never prompt for a successor before deactivating someone who
-- actually holds live deals.
--
-- Fixed the same way blind_reassign_all_deals (0042) already solved this exact class of
-- problem: a SECURITY DEFINER function that returns only a count per rep, never a deal id,
-- name, value, or stage -- Admin gets the number it needs to gate the UI correctly without
-- ever seeing deal content, preserving the spec's "zero visibility into deal names, values,
-- stages, or mapping completeness, anywhere."
create or replace function public.admin_deal_counts_by_user(p_org_id uuid)
returns table(user_id uuid, deal_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = auth.uid() and is_admin
  ) then
    raise exception 'Only this organization''s Admin can read teammate bivy counts';
  end if;

  return query
  select d.assigned_to, count(*)
  from deals d
  where d.org_id = p_org_id
  group by d.assigned_to;
end;
$$;

revoke all on function public.admin_deal_counts_by_user(uuid) from public;
grant execute on function public.admin_deal_counts_by_user(uuid) to authenticated;

-- Team Admin/Manager Rework, Data model #5: Admin's "move every one of this rep's bivys to
-- a successor" action, used during deactivation. Built as the ONLY correct way to satisfy
-- "Admin reassigns without ever seeing a deal": a security-definer function that updates
-- assigned_to directly and returns nothing but a count, so Admin's own client never needs
-- (and structurally cannot get) SELECT access to the rows it's moving -- there is no path
-- here where Admin's session fetches deal rows to perform this.
--
-- Distinct from Manager's reassignment (built client-side against the existing deals_select/
-- can_manage_deal policies in a later step) which is deliberately informed -- Manager sees
-- deal name/value/stage while choosing. This RPC is the blind, bulk, deactivation-only path.
create or replace function public.blind_reassign_all_deals(
  p_org_id uuid,
  p_from_user uuid,
  p_to_user uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = auth.uid() and is_admin
  ) then
    raise exception 'Only this organization''s Admin can perform a blind reassignment';
  end if;

  -- Both ends of the move must actually be members of this exact org (not, say, a stray
  -- user_id from a different org the caller doesn't administer), and the successor must be
  -- active -- otherwise this could silently orphan bivys onto someone outside the org, or
  -- resurrect a deactivated account's queue.
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_from_user) then
    raise exception 'from_user is not a member of this organization';
  end if;
  if not exists (select 1 from organization_members where org_id = p_org_id and user_id = p_to_user and status = 'active') then
    raise exception 'to_user must be an active member of this organization';
  end if;

  update deals
  set assigned_to = p_to_user
  where org_id = p_org_id and assigned_to = p_from_user;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.blind_reassign_all_deals(uuid, uuid, uuid) from public;
grant execute on function public.blind_reassign_all_deals(uuid, uuid, uuid) to authenticated;

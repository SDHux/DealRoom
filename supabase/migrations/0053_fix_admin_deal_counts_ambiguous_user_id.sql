-- The RETURNS TABLE(user_id ...) output column shadowed organization_members.user_id in
-- the admin check, so every call failed with "column reference user_id is ambiguous".
-- The Admin Portal showed 0 bivys for every rep, and Deactivate skipped the successor
-- hand-off (it only asks for one when the count is > 0).
create or replace function public.admin_deal_counts_by_user(p_org_id uuid)
returns table(user_id uuid, deal_count bigint)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (
    select 1 from organization_members om
    where om.org_id = p_org_id and om.user_id = auth.uid() and om.is_admin
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

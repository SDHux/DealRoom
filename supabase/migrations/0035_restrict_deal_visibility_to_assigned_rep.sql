-- Restricts deal visibility per TEAM-VERSION-ADMIN-MANAGER-SPEC.md: a plain `member` sees
-- only deals assigned to them; owner/admin keep full org-wide visibility (needed for the
-- Manager Overview and for managing/reassigning any deal).
--
-- Safe for every existing Single-tier org: a one-member org's sole user is always `owner`
-- (0002's one-owner-per-org constraint), so current_org_role(org_id) in ('owner','admin')
-- always evaluates true there -- this is structurally guaranteed, not just tested, per the
-- spec's guardrail #1. The restriction only bites in a multi-member org.
--
-- ROLLBACK (keep next to the forward migration, per spec guardrail #6 -- if this behaves
-- unexpectedly in production, run this instead of scrambling to reconstruct the old
-- policy):
--
--   drop policy deals_select on deals;
--   create policy deals_select on deals
--     for select
--     using (is_org_member(org_id));

drop policy deals_select on deals;

create policy deals_select on deals
  for select
  using (
    current_org_role(org_id) in ('owner', 'admin')
    or assigned_to = auth.uid()
  );

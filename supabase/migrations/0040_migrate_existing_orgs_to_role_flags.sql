-- Team Admin/Manager Rework, Data model #3: migrates the (six, per live production as of
-- 2026-09-13) existing orgs from role text to the new is_admin/is_manager flags.
--
-- Data-driven, not hardcoded to specific org/user ids -- computed from each row's existing
-- `role` plus its org's live member count, so this is correct regardless of exactly which
-- orgs exist:
--   owner  -> is_admin = true always
--   admin  -> is_manager = true (today's admin role is org-management-but-not-billing;
--             the closest fit under the new split is Manager, not Admin)
--   member -> neither (Rep), unchanged
--
-- SOLO-SAFETY FIX (not in the original mapping table as first drafted -- caught before this
-- ran): a solo org's owner ALSO gets is_manager = true, not is_admin alone. Applying the
-- bare mapping above to every owner row, including a one-person org's sole user, would have
-- silently stripped every existing solo customer of their own deal visibility the moment
-- current_org_is_manager (0039, is_manager-only) went live -- the exact regression this
-- entire product's guardrails have been trying to prevent, just arrived at from the
-- opposite direction. A solo org's owner is still its Admin (billing/roster), but with only
-- one person in the org they necessarily also need real deal visibility, so they get both
-- flags. The one org that's genuinely multi-member today (an owner with other members
-- already in it) gets is_admin only, matching the new intended split -- that owner reaches
-- deal content through "View as Manager" going forward, same as any other Admin will.
update organization_members m
set
  is_admin = (m.role = 'owner'),
  is_manager = (
    m.role = 'admin'
    or (m.role = 'owner' and (select count(*) from organization_members m2 where m2.org_id = m.org_id) = 1)
  );

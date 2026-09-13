-- TEMPORARY lockdown (Mark's call, Sep 2026): the Team-tier rollout (0033-0037) surfaced
-- several open issues during manual testing -- a member with no way to reach their own
-- profile, a reassign control that commits instantly with no confirmation, a manager-view
-- navigation dead end -- serious enough that Mark wants to stop any NEW solo org from
-- becoming a team while those get ironed out, without disrupting the one org already being
-- used to iterate on the fixes.
--
-- Enforced here (not just hidden client-side in app.jsx's Invite a teammate section) so
-- this actually holds even against a direct API call, not just the normal UI.
--
-- ROLLBACK (once the open issues are resolved and Mark wants to reopen signups):
--
--   drop policy org_invitations_insert on org_invitations;
--   create policy org_invitations_insert on org_invitations
--     for insert
--     with check (
--       invited_by = auth.uid()
--       and (
--         current_org_role(org_id) = 'owner'
--         or (current_org_role(org_id) = 'admin' and role = 'member')
--       )
--     );

drop policy org_invitations_insert on org_invitations;

create policy org_invitations_insert on org_invitations
  for insert
  with check (
    invited_by = auth.uid()
    and (
      current_org_role(org_id) = 'owner'
      or (current_org_role(org_id) = 'admin' and role = 'member')
    )
    -- The new condition: an org that's currently solo (exactly one member) can't create its
    -- first invite. An org that already has 2+ members (already a team) is unaffected, so
    -- testing/iteration on the existing team org continues to work.
    and (select count(*) from organization_members om where om.org_id = org_invitations.org_id) > 1
  );

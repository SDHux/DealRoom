# Team Version — QA Checklist

Companion to `team-admin-manager-rework-spec.md`. Use this once Claude Code says a chunk is ready — it's the acceptance criteria, not a status report. Each item should get a pass/fail, not a guess; where a check can only really be confirmed by looking at network traffic or a live database row, that's called out explicitly rather than left to "should be fine."

Organized backend first (data/security — the stuff that's wrong if it's wrong for everyone, silently), then UI/UX (per role), then a final bug-by-bug sign-off tying back to the spec's punch list.

## A. Backend / data model

### A1. Role flags & the six-org migration
- [ ] Query production directly: every existing org's `organization_members` rows have `is_admin`/`is_manager`/`status` set per the confirmed mapping (`owner`→`is_admin`, `admin`→`is_manager`, `member`→neither) — don't trust the migration ran clean, read the actual rows.
- [ ] `role` column is untouched and still populated — confirm the 0002-era policies that key off it (`org_members_insert`/`update`/`delete`, `org_invitations` policies, `current_org_role()`) still work normally.
- [ ] SRENE.io and Valence Intelligence (the two real orgs kept after cleanup) land in the correct roles for their actual people — spot check by name, not just row count.
- [ ] Legacy dormant gap re-check: confirm zero orgs currently have a stray `admin`-role row carrying broader account-control permissions than the new model intends. This was flagged as affecting zero rows earlier — re-verify it's still zero right before the Admin Portal's "assign Manager" UI ships, not back when it was first flagged.

### A2. Deal visibility (RLS)
- [ ] Solo-org invariant: a one-person org's sole user sees 100% of their own deals. Test against a real solo account, not just a fresh one.
- [ ] Admin (not also Manager): zero deal content anywhere — not in the UI, and not in raw API responses. Open devtools/network tab as Admin and confirm no endpoint returns deal name, value, stage, or mapping completeness, even ones the UI doesn't render. This is the one that matters most — a UI that hides data the API still returns isn't actually secure.
- [ ] Manager: sees every rep's deals in their org, full detail, in both Team Overview and drill-in.
- [ ] Rep: sees only their own deals, nothing from teammates.
- [ ] "View as Manager" (Admin impersonation): toggling on immediately grants full deal visibility; toggling off immediately revokes it — including a check that a page already loaded with data doesn't keep showing it after revert (stale client state masking a real permission change).
- [ ] `deal_assignment_history_select` follows the same rules — Admin can't read reassignment history content, Manager can.

### A3. Blind reassignment RPC (Admin's deactivation flow)
- [ ] Successful call returns a count only — confirm via network inspection, not just the UI's rendering of the response.
- [ ] Non-Admin caller (Manager or Rep) is rejected.
- [ ] All of the deactivated rep's active bivys move to the chosen successor; `deal_assignment_history` records the change.
- [ ] Edge case: deactivating a rep with zero active bivys doesn't force a successor prompt or error.
- [ ] Edge case: a rep with a large number of bivys (10+) reassigns cleanly in one call, no partial failure.

### A4. Informed reassignment (Manager's flow)
- [ ] Manager sees deal name/value/stage while choosing a destination rep, both from the Team Overview row action and the per-dealroom line in drill-in.
- [ ] Confirmation step is required before the reassignment commits — no silent one-click moves (closes Bug 2).
- [ ] `deal_assignment_history` logs actor, timestamp, and both reps correctly.

### A5. Deactivation
- [ ] `status` transitions `active`→`deactivated` correctly; `deal_assignment_history` for that rep survives intact.
- [ ] A deactivated rep cannot log in (test this directly — attempt sign-in with their real credentials post-deactivation).

### A6. Invite-provisioning flow (the new build)
- [ ] Admin submitting name + email creates: a real `auth.users` row via the Admin API (not a raw insert), an `organization_members` row (Rep, no flags, `status='invited'`), a bivy row, with Team info (manager name, roster) and General settings (org name, logo) auto-populated from the inviting org.
- [ ] The account's actual Supabase password is a long random value the client never sees or receives — confirm by inspecting the API response and network traffic, no password field in transit.
- [ ] The 6-digit code is stored bcrypt-hashed (via `pgcrypto`) on the `organization_members` row, with an attempt counter and expiry — confirm by checking the actual column value isn't plaintext or a fast hash.
- [ ] Automated activation email actually arrives in a real inbox (not just fires without erroring) — this rides the same flaky Gmail relay as other known bugs, so don't just trust "no error returned."
- [ ] "Copy invite link" button produces a working URL that lands the rep directly on the activation UI, independent of whether the email arrived.
- [ ] Duplicate-email case (Bug 7): inviting an email that already has a Solo myBivy account returns a clear, specific, actionable message to the Admin — not a crash, not a silent no-op, not a duplicate account.
- [ ] Partial-failure rollback: force a failure between account creation and the org-membership/profile write (e.g. temporarily break the second call in a test environment) and confirm the orphaned `auth.users` row gets deleted, and the Admin can cleanly retry the same invite afterward.
- [ ] Authorization: both `provision_teammate` and `resend_teammate_code` reject a caller who isn't `is_admin` on the target org — test this directly by calling as a Manager or Rep and confirming a 403, not just assuming the check exists.

### A7. Activation exchange (`/api/activate-teammate`)
- [ ] Correct code: marks the code used, calls `admin.generateLink` (recovery), client exchanges via `verifyOtp`, fires `PASSWORD_RECOVERY`, and the existing `ResetPassword` UI runs without signing the rep back out afterward.
- [ ] Wrong code: generic "invalid code" response — doesn't reveal whether the email exists or which part of the check failed. Increments the attempt counter.
- [ ] Lockout after the configured attempt cap (5–10): further attempts are rejected until Admin hits Resend.
- [ ] Resend clears the attempt counter to zero and issues a fresh code + expiry — confirm a previously-locked-out rep can activate immediately after a resend, not still blocked.
- [ ] Expiry: a code past its TTL (test by manually backdating one in a test environment) is rejected as expired, not accepted.
- [ ] Concurrency: fire two simultaneous requests with the correct code (a simple double-click or two parallel API calls) and confirm only one succeeds — the other should see "already used," not a duplicate account or a double-fired recovery link.

### A8. `plan_tier` / seat caps / pricing
- [ ] A brand-new Team signup lands directly on a paid tier — never passes through any trial state.
- [ ] Seat cap trigger blocks inviting past the org's current tier (test: invite a 6th rep on a 5-seat org, confirm it's blocked with a clear upgrade prompt, not a silent failure or an unenforced 6th seat).
- [ ] Admin Portal's seat/plan stat tiles reflect the real, current tier and seat usage — not a stale or hardcoded number.
- [ ] Confirm whether a tier-upgrade purchase path actually exists yet for when a customer needs to cross a cap — if not built, this should be a known gap going into launch, not discovered by a real customer hitting the cap.

### A9. Negative/security testing (don't skip these — they're the point of this rework)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` never appears client-side — check the bundled JS and network requests, not just the source code.
- [ ] Every RLS policy touched by this rework still applies normally to ordinary (non-service-role) requests — a service-role bypass in one function shouldn't be mistaken for a broader RLS relaxation.
- [ ] Re-run the original solo-regression checklist from the prior spec against a real solo account after all of this ships, not just once mid-build.

## B. UI / UX, by role

### B1. Navigation and landing
- [ ] Admin lands on the Admin Portal by default; no shared/dual tab nav with Manager or Rep views.
- [ ] Manager lands on Team Overview by default.
- [ ] Rep lands on their own bivy; no Team/Admin nav visible anywhere in their UI.
- [ ] "View as Manager" toggle (Admin only): visible as a flag on Admin's own roster row, changes live when toggled, shows the impersonation banner while active, and has one always-available "Exit manager view" control in the drill-in banner — no two-hop dead-end path (closes Bug 3).

### B2. Admin Portal
- [ ] Stat tiles (Plan / Seats / Next Invoice / Billing status) show correct, live data with the distinct colored top-borders per the design spec.
- [ ] Roster panel: green-tinted header, alternating row shading, role dropdown limited to Manager/Rep only (Admin isn't an assignable role here), Deactivate/Remove actions work end to end.
- [ ] Billing modal (update card / cancel plan) functions against Stripe (sandbox is fine pre-launch, but test it, don't assume).
- [ ] "Run team setup" wizard's invite step reflects the new provisioning flow (name/email/copy-link), not leftover copy assuming the old passive `org_invitations` mechanism.
- [ ] First-time setup popup shows once on first Admin Portal visit, is dismissible, and doesn't reappear on subsequent visits.
- [ ] No "Account" tab or any lingering nav path back to a solo-style settings view anywhere in the Admin or Manager UI.

### B3. Manager / Team Overview / drill-in
- [ ] Rep list is rank-stacked by pipeline value, unnumbered, with pipeline bars and stage-breakdown mini bars per rep.
- [ ] Reassign button is on each Team Overview rep row (bulk, from the list) — confirmed as the preferred permanent location.
- [ ] Drill-in header shows only the back-pill exit control, no top-right reassign button.
- [ ] Each dealroom line in drill-in has its own reassign action (informed, single-deal).
- [ ] Every reassignment (bulk or single) requires confirmation before committing — no silent one-click moves.

### B4. Rep view
- [ ] Rep can reach their own profile settings (closes Bug 1) — test this specifically, it was a confirmed gating bug.
- [ ] No billing tab visible anywhere in Rep's settings on Team.
- [ ] No Team/Admin nav visible.

### B5. Invite UI (Admin-facing)
- [ ] Admin enters name + email, submits, and gets both a confirmation that an email was sent and a "Copy invite link" button in the same flow.
- [ ] Copy-link produces a URL that lands the rep directly on the activation screen.
- [ ] A per-pending-invite "Resend" action is available and gives clear feedback when used (e.g. a toast confirming a new code was sent).

### B6. Activation UI (rep-facing)
- [ ] Rep enters email + 6-digit code; wrong code shows a clear, generic error without revealing account existence.
- [ ] Lockout state has a clear, actionable message ("too many attempts — ask your admin to resend"), not a dead end.
- [ ] Correct code transitions smoothly into the set-new-password flow (reused `ResetPassword` UI) with no confusing intermediate state.
- [ ] After activation, rep lands directly in a fully-populated bivy — org name, logo, and team roster already present, no re-entry of information a Solo signup would normally ask for.

### B7. Solo signup (adjacent — must not regress)
- [ ] ToS/Privacy checkbox still gates signup (functionally unchanged).
- [ ] Copy no longer shows "(pending)" — confirm this is still live post any related deploys.
- [ ] Once Termly URLs are added: both links render as real, working, new-tab links, not the old muted placeholder text.
- [ ] Solo's own trial/signup behavior is unaffected by the Team no-trial change — confirm Solo still behaves exactly as it did before this rework touched `plan_tier`.

### B8. Visual/brand consistency
- [ ] myBivy top header renders black with white lettering, matching the sidebar nav look, on the Admin Portal and Team Overview.
- [ ] No new colors outside the existing palette anywhere this rework touched.
- [ ] Mobile rendering check on Admin Portal, Team Overview, drill-in, invite UI, and the activation UI specifically (narrowest, least-tested surface here).

## C. Bug-by-bug sign-off

Tie the above back to the spec's punch list explicitly — mark each closed, open, or deferred, not just "done":

- [ ] Bug 1 — member profile access (closed by B4 above)
- [ ] Bug 2 — reassignment confirmation step (closed by A4/B3 above)
- [ ] Bug 3 — Manager drill-in dead-end nav (closed by B1 above)
- [ ] Bug 4 — passive invite mechanism (closed by A6/A7/B5/B6 above)
- [ ] Bug 5 — Solo confirmation email link — still open, separate track, not touched by this rework
- [ ] Bug 6 — "Couldn't send invite" error — moot once this ships and replaces the old `org_invitations` UI path; confirm it's actually gone, not just superseded in theory
- [ ] Bug 7 — existing-email edge case (closed by A6 above)
- [ ] Bug 8 — `plan_tier` tracking (closed by A8 above)
- [ ] Bug 9 — seat cap / pricing (closed by A8 above)
- [ ] Bug 10 — ToS/Privacy Solo signup — mostly closed (B7 above), fully closed once Termly URLs are in
- [ ] Bug 11 — Solo vs. Team activation split — still open, separate track, should land before this is marketed as a distinct Team tier

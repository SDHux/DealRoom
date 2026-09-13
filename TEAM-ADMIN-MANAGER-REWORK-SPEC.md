# Team Admin/Manager Rework — Requirements & Build Spec

Last updated: September 13, 2026
Supersedes the role model in `TEAM-VERSION-ADMIN-MANAGER-SPEC.md` (that doc's migrations 0033–0037 are still live and mostly reusable, but its owner/admin/member permission split is not what ships now — see below). Companion: `TEAM-VERSION-BASECAMP-PLAN.md` (the open bug list this spec absorbs and re-prioritizes).

**A companion file, `team-admin-manager-mockup.html`, sits alongside this doc in the repo root — open it directly in a browser.** It is the actual interactive, Mark-approved visual design for the Admin Portal and Team Overview/drill-in screens: layout, colors, stat tiles, roster panel styling, the setup wizard, all of it. This spec describes permissions and data flow; the HTML file is the visual source of truth for anything about how a screen should look. Previous work extended the existing app's old dark "Team & Settings" modal instead of building this design — that modal is what gets replaced, not extended.

**Build status (September 13, 2026):**

- **Build order step 1 (data model) — shipped, live in production** (migrations 0039–0043): `is_admin`/`is_manager`/`status` columns added alongside `role` (not replacing it); the six production orgs migrated from live current state; `deals_select`/`can_manage_deal`/`can_view_deal`/`deal_assignment_history_select` rewritten around `is_manager`, verified live that Admin no longer implies deal visibility anywhere; solo-org invariant re-verified live and holds; `blind_reassign_all_deals` RPC built and verified; `plan_tier` Team bands (`team_5`/`team_10`/`team_15`) plus seat-cap trigger shipped.
- **Invite-provisioning flow (Data model #1) — shipped**: `provision-teammate.mts` and `activate-teammate.mts` Netlify functions, bcrypt-hashed 6-digit activation codes, forced password reset on first login. See migrations 0039–0044 and the two `.mts` functions in `netlify/functions/`.
- **Admin Portal / Team Overview functional logic — built, but riding on the OLD "Team & Settings" modal visual design, not the mockup.** Bugs 1, 2, and 3 are functionally closed (see commit `e2276f1`): profile access is no longer role-gated, reassignment requires explicit confirmation, and a direct exit control exists in the drill-in banner. The permission logic, deactivation/reassignment flow, and "View as Manager" toggle all work correctly per spec. **What's missing is the actual visual design from `team-admin-manager-mockup.html`** — the terracotta-accented Admin Portal with stat tiles (Plan/Seats/Next Invoice/Billing status), the green-headed roster panel, the "Run team setup" wizard, and the Team Overview's rank-stacked rep list with pipeline bars. None of that has been built yet; the current UI is the pre-existing dark modal with the new permission logic wired into it. This is the next piece of work: re-skin the already-correct functionality to match the mockup, not rebuild the logic.

## Why this doc exists

Migrations 0033–0037 shipped a working Manager Overview, but built it on the existing owner/admin/member model, where admin and owner both had full deal visibility. Working through the actual admin/manager use cases surfaced a real separation-of-duties requirement that model doesn't support: **Admin should never see deal content, and Manager should never touch billing or the roster.** That's not a tweak to the shipped RLS policy, it's a different permission model.

## The locked permission model

Three roles, not interchangeable:

**Admin** — account and access control only.
- Create a rep account and their (empty) bivy, via the invite-provisions-the-bivy flow (Data model #1)
- Set a teammate's role: Manager or Rep (Admin is not an assignable role from this screen — one Admin per org today, the converted owner)
- Deactivate a rep's account. If that rep holds active bivys, Admin must choose a successor and every bivy moves to them in one blind bulk action — Admin never sees deal names, values, stages, or which specific bivys moved, only a count ("Marcus Webb has 4 active bivys")
- Billing: view plan, seats, next invoice, payment method, cancel
- Zero visibility into deal names, values, stages, or mapping completeness, anywhere
- Can switch into a real "View as Manager" mode without changing identity or logging in as anyone else — a real permission grant (flips `is_manager` on their own row), not a client-side toggle
- Cannot reassign an individual bivy while leaving the rep active — that requires seeing the deal, which is Manager's job, not Admin's

**Manager** — full performance visibility, zero account control.
- Everything the current Manager Overview + rep drill-in already does: rank-stacked pipeline, stage breakdown, deal-by-deal mapping completeness
- Can reassign one or more of a rep's bivys to another rep, informed (sees deal name, value, stage while choosing) — distinct from Admin's blind bulk version used only during deactivation
- Cannot deactivate an account, change anyone's role, or see billing in any form
- Has no bivy of their own

**Rep** — unchanged from today's product, with one gap closed, plus a new account-creation path.
- Own bivys and own profile only
- Never sees billing, on Team, in any settings surface
- Their account and bivy exist *before* they ever log in — created the moment Admin sends the invite, not created by the rep themselves the way Solo signup works today

## Data model — all shipped, live in production

1. **Invite = bivy provisioning.** Admin enters name + email → system creates `auth.users` row (via Supabase Admin API, `provision-teammate.mts`, using `SUPABASE_SERVICE_ROLE_KEY`), `organization_members` row (Rep, `status='invited'`), bivy, auto-populated Team/General settings from the org. One-time bcrypt-hashed 6-digit code stored on the `organization_members` row with attempt counter + expiry (not the literal Supabase password — a long random password is set that the client never sees). Delivery: automatic email plus a "Copy invite link" fallback. Activation (`activate-teammate.mts`): correct code → `admin.generateLink` (recovery) → client `verifyOtp` → real session → forced password set via the existing `ResetPassword` UI. Wrong code → generic error, attempt counter increments, locks out after cap until Admin resends. Migrations: 0039–0044.
2. **Role storage**: `is_admin`/`is_manager` as new columns alongside the existing `role` column (not replacing it — `role` still backs older 0002-era policies).
3. **Six production orgs migrated**: `owner`→`is_admin`, `admin`→`is_manager`, `member`→Rep. Pulled from live current state. One known dormant gap: a legacy `admin`-role row could retain broader permissions than intended under the new model — currently affects zero rows, worth a look when building the roster's role-assignment UI.
4. **`deals_select` RLS and related policies** rewritten around `is_manager`. Solo-org invariant re-verified live and holds.
5. **`blind_reassign_all_deals`** security-definer RPC: Admin gets a count only, non-Admin callers rejected.
6. **`status`** (`active`/`invited`/`deactivated`) on `organization_members`.
7. **`plan_tier`** Team bands (`team_5`/`team_10`/`team_15`) + seat-cap trigger. No trial period for Team — signups go straight to paid billing.

## Team pricing

Tiered/banded, hard seat caps (no metering within a tier), no trial:

| Tier (reps) | Monthly price |
|---|---|
| Up to 5 | $449/mo |
| Up to 10 | $690/mo |
| Up to 15 | $996/mo |

## What's left: the visual layer

This is the actual remaining work. Everything above is done and correct. What's not done is making the screens look like `team-admin-manager-mockup.html` instead of the old dark "Team & Settings" modal:

- Admin Portal: page header with "Run team setup" button, 4 stat tiles (Plan/Seats/Next Invoice/Billing status) with distinct colored top-borders, roster panel with a green-tinted header and alternating row shading, role dropdown limited to Manager/Rep.
- Team Overview: rank-stacked (unnumbered) rep list with pipeline bars and stage-breakdown mini bars, a "⇄ Reassign" action directly on each rep row.
- Rep drill-in: back-pill-only header (no top-right reassign button, already correctly removed), per-dealroom-line reassign buttons (already functionally present per commit `e2276f1`, needs the visual treatment).
- The invite UI: needs to visually reflect the new provisioning flow (name/email entry, copy-link button, resend action) — the functional pieces exist, the presentation doesn't yet match the mockup's wizard/invite-panel design.
- Top bar: myBivy wordmark treatment, role badge + "View as Manager" button (Admin only) + avatar, no lettered logo square, no company-name pill.
- Color tokens: terracotta accent family (`--accent`, `--accent-strong`, `--accent-soft`), light/near-white background tokens — see the mockup file's `:root` CSS custom properties directly rather than re-deriving them.

None of this requires touching the permission logic, RLS, or the invite-provisioning backend again — it's a presentation-layer pass over functionality that already works.

## QA checklist

A full backend + UI/UX QA checklist exists as a companion doc: `TEAM-VERSION-QA-CHECKLIST.md` (also in this repo root). Use it as acceptance criteria once the visual layer above is built.

# Team Version — Admin Role & Manager Overview: Requirements & Build Spec

Last updated: September 12, 2026
Companion doc: TEAM-VERSION-BASECAMP-PLAN.md (pricing/packaging + capacity audit — this doc is the feature spec that plan pointed to)

## What Mark asked for (verbatim scope)

Two product offerings going forward: **Single** (today's product, one rep per org, unchanged) and **Team** (multi-rep org with an Admin role). The Team tier's defining difference:

- Admin manages billing, creates users, and establishes roles and permissions.
- Admin gets a **Manager Overview**: active reps, active sales-cycle count and per-stage deal counts per rep, reps rank-stacked by pipeline dollar value, click a rep's name to view their bivy (deal rooms), click back out to the overview.
- Explicitly **no automated analytics/red-flag scoring** — descoped in this pass, keep it to a plain data rollup.
- **Reps must not be able to access any deal room other than the ones they're assigned to.** This is a new restriction, not how the product works today (see Reality check below).

**Purpose, in Mark's words:** this is built to facilitate manager/rep 1:1 review and discussion, and to give the manager clear visibility into how well a deal is mapped out. That framing matters for how the overview should behave — it's a coaching tool a manager and rep look at together, not a monitoring tool a manager checks alone. It also adds a real dimension beyond the counts/dollars above: **deal mapping completeness** (see its own section below), which is different from a red-flag/health score and stays inside positioning because it reflects what's actually filled in inside the deal room itself, not an inferred judgment about the rep or the deal's likelihood to close.

## Reality check — this changes existing behavior, not just adds a screen

Today, per `supabase/migrations/0003_deals.sql`, deal visibility is **org-wide by design**:

```sql
-- Team-wide visibility by default: any org member (owner/admin/member) can read every
-- deal in their org, not just their own.
create policy deals_select on deals
  for select
  using (is_org_member(org_id));
```

And the app's own data load (`app.jsx`, the `DealRoom` component's org-load effect) fetches every deal for the org in one query with no per-rep filter: `sb.from("deals").select(...).eq("org_id", mem.org_id)`. Every deal room a rep sees today is simply "every deal room that exists in this org." This was a deliberate choice for the single-user product (irrelevant there, since there's only one rep) and happened to carry over harmlessly.

For Team, Mark's requirement inverts this: a rep (`member` role) should see **only deals assigned to them**; only `owner`/`admin` (the Admin/manager role) should see everything, which is exactly what the Manager Overview needs anyway. This is a real permission-model change, not a UI addition — flagging it plainly so it isn't discovered mid-build.

**Roles used below:** reuse the existing three-role model (`owner` / `admin` / `member`) from migration `0002` rather than inventing a fourth role. "Admin" in Mark's ask maps directly onto the existing `admin` role (which already has full deal CRUD via `can_manage_deal`); `owner` gets the same access by extension. No new role enum value needed.

## Data model changes

### 1. Add explicit deal assignment (new column, new migration)

Do not reuse `created_by` as the access-control field. `created_by` is an audit fact ("who set this deal room up") and should stay immutable; assignment ("whose deal room is this right now") needs to be reassignable when an account gets handed to a different rep, without rewriting history.

```sql
-- New migration, e.g. 0033_deal_assignment.sql
alter table deals add column assigned_to uuid references auth.users (id) on delete set null;

-- Backfill: every existing deal is currently "assigned" to whoever created it, since
-- that's the closest approximation of today's implicit behavior for single-user orgs.
update deals set assigned_to = created_by where assigned_to is null;
```

Set `assigned_to = created_by` as the default at deal-creation time in the insert path (`app.jsx`'s deal-create function, currently inserting a plain `deals` row with `created_by`), then let owner/admin change it later (e.g., from the deal's settings, or directly from the Manager Overview when handing off an account).

### 2. Tighten the deals_select RLS policy

```sql
-- Replaces the org-wide select policy in 0003. Owner/admin keep full org visibility
-- (needed for the Manager Overview and for reassigning/managing any deal); a plain
-- member only sees deals assigned to them.
drop policy deals_select on deals;

create policy deals_select on deals
  for select
  using (
    current_org_role(org_id) in ('owner', 'admin')
    or assigned_to = auth.uid()
  );
```

This is safe for every existing Single-tier org: a one-member org's single rep is always `owner`, so they keep seeing everything, nothing changes for the current product. The restriction only bites in a multi-member org, which is exactly the Team-tier scenario it's meant for.

### 3. Client-side fetch stays a straight org-wide query

No client change needed for the restriction itself — RLS does the filtering server-side automatically, so `sb.from("deals").select(...).eq("org_id", orgId)` for a `member` naturally comes back with only their assigned deals, and for `owner`/`admin` comes back with everything. This is the same pattern already used elsewhere in the app (RLS as the real gate, client code stays simple) — see `enforce_org_not_locked` and `enforce_active_sequence` for precedent.

## Admin role: billing, user management, roles & permissions

Most of the underlying mechanism already exists and needs no new build:

- **Billing management** — already Admin/Owner-only in effect: `create-checkout-session.mts` and `create-portal-session.mts` already require the caller be `role = 'owner'` in `organization_members` (see the 403 check in both functions). **Decision needed from Mark:** should `admin` (not just `owner`) also be allowed to manage billing? Today only `owner` can. If yes, that's a one-line change in both functions (`roles[0].role !== "owner"` → `!['owner','admin'].includes(roles[0].role)`).
- **Create users** — already built: the Team tab's invite flow (`org_invitations`, migration `0010`) lets `owner` or `admin` invite by email with a role.
- **Establish roles and permissions** — partially already built: `admin` can invite/manage `member` rows; only `owner` can create/manage another `admin`. This existing constraint (admin can't mint other admins) is a reasonable default and is left as-is unless Mark wants admins to be able to promote members to admin too — flagging it as a call, not silently changing it.

**Net new build here:** essentially nothing beyond confirming the billing-permission question above. The gap Mark is describing ("Admin manages billing, creates users, establishes roles") is mostly already true of the `admin`/`owner` roles today; it just isn't packaged or marketed as a distinct "Team" capability yet, and there's no screen that shows an admin the full picture in one place (that's the Manager Overview, below).

## Manager Overview — new screen

A new tab/view, visible only to `owner`/`admin` (reuse the same `current_org_role` check the Billing tab already uses), showing:

1. **Rep list** — every `organization_members` row for the org, joined to `profiles` for display name/avatar. One row per rep.
2. **Active sales cycles per rep** — count of that rep's `assigned_to` deals where `archived_at is null` and `stage` is not `'Closed Won'`/`'Closed Lost'`.
3. **Deals per stage per rep** — same filtered set, grouped by `stage` (the existing 7-value enum: Discovery, Evaluation, Trial, Proposal, Negotiation, Closed Won, Closed Lost). A small stage-count breakdown per rep row, not a full chart — keep it simple per Mark's explicit descope of analytics.
4. **Rank-stacked by pipeline dollar** — sort the rep list descending by `sum(value_amount)` across that rep's active (non-closed) deals. This is the default sort order of the list, not a separate widget.
5. **Click into a rep's bivy** — clicking a rep's name switches the main deal-room view to that rep's assigned deals only (reuse the existing `DealRoom` list/sidebar UI, just pre-filtered to `assigned_to = <that rep's user id>` instead of the normal "everything I can see" query — for an admin this is a manual override of their own default "see everything" view). A visible "back to team overview" affordance returns to the Manager Overview. This is view-only for the admin looking at someone else's deals unless they'd normally have edit rights anyway (`can_manage_deal` already grants owner/admin edit rights org-wide, so no new permission logic needed for the drill-in itself).

Since this screen's purpose is to sit next to a rep during a 1:1, both the rep and the manager should be able to reach the same drill-in view: a rep looking at their own row sees exactly what the manager sees when they click in, just without the rest of the team's rows around it. No separate "rep view" of the overview needs building — the drill-in view already is that, and it's reachable today by any rep just by opening their own normal deal list.

### Deal mapping completeness (in scope, and distinct from analytics/red flags)

This is the piece that actually serves the stated purpose (coaching on how well a deal is mapped out), and it's worth being precise about why it's different from the "no automated analytics" descope: it doesn't infer or score anything about the deal's health or the rep's performance. It just surfaces what's filled in versus not, using data the rep already put in the deal room:

- **Stakeholders mapped** — count of `stakeholders` rows on the deal (any identified stakeholder counts; no scoring of role coverage in this pass).
- **MEDDPIC captured** — whether the deal's `meddpic` field (or whatever the current MEDDPIC data shape is — confirm exact column/JSON shape in the repo before building) has non-empty values, shown as a simple "X of 7 elements filled" count.
- **Discovery/exec summary present** — whether `discovery` and `exec_summary` (both JSONB, already on `deals`) are non-empty versus still default `{}`.
- **Tasks planned** — count of `deal_tasks` (pre-signature) or `deal_experience_items` (post-signature, whichever sequence is active) with real content, versus a deal room with none set up.

Surface this as a compact per-deal indicator in the rep drill-in view (e.g., "3 of 4 mapping areas complete" per deal, not a single blended "health score"), so a manager and rep can literally look at one deal together and see what's missing. Do **not** roll these into a single number per rep or use them to rank/sort reps — that would start to look like the scored health signal Mark explicitly descoped. Keep it deal-by-deal and descriptive, not aggregated or judged.

## Open questions for Mark (small, but worth a real answer before Claude Code finalizes the UI)

1. Should `admin` be allowed to manage billing (not just `owner`), or keep billing owner-only?
2. Should `admin` be allowed to promote a `member` to `admin`, or keep that owner-only as today?
3. When an admin reassigns a deal from one rep to another (`assigned_to` change), should the original rep lose access immediately, and should there be any notice/audit trail of the reassignment, or is a plain silent field update sufficient for now?
4. Does the Manager Overview need to include the admin/owner's own deals in the rank-stack (i.e., does an owner who also personally works deals show up as a row alongside their reps), or is it reps-only?
5. For the mapping-completeness indicator: is "4 of 4 areas complete" (stakeholders/MEDDPIC/discovery/tasks) the right set of areas, or does Mark want a different or more granular checklist for what "well mapped" means in a 1:1 conversation?

## Suggested build order for Claude Code

1. Migration: add `deals.assigned_to`, backfill from `created_by`, set default at insert time going forward.
2. Migration: replace `deals_select` RLS policy with the assigned-to-restricted version above.
3. Verify nothing else silently assumed org-wide member visibility (grep for `is_org_member` usages touching deals-adjacent tables — `deal_tasks`, `deal_experience_items`, `stakeholders`, `documents` all likely inherit visibility via their own `is_org_member`/deal-join checks and need the same review, since today they're probably just as org-wide as `deals` was).
4. Build the Manager Overview screen (list + counts + rank-stack + drill-in/back navigation), gated to `owner`/`admin`.
5. Answer the billing/promotion open questions above and wire the one-line permission changes if Mark wants them.
6. Manual QA: create a test org with 2+ members at different roles, confirm a `member` only sees their own assigned deals, confirm `owner`/`admin` see everything and the Manager Overview numbers match.

*Sources: direct inspection of `supabase/migrations/0002_organizations_and_membership.sql`, `0003_deals.sql`, `0010_org_invitations.sql`, `0015_meddpic_overrides.sql`, `netlify/functions/create-checkout-session.mts`, `netlify/functions/create-portal-session.mts`, and the `DealRoom`/Team tab code in `app.jsx` (this session, September 12, 2026); scope confirmed directly with Mark, including the 1:1-coaching purpose behind the Manager Overview and the explicit decision to descope automated analytics/red-flag signals for this pass.*

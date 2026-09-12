# Basecamp Plan — Contingency + Team Version, run in parallel

Last updated: September 12, 2026

## Working assumptions (confirm with Mark)

- "Team version" = a paid multi-seat tier where an org (myBivy already auto-creates one per signup) holds more than one rep, sharing visibility into shared deal rooms. Not a manager/RevOps reporting layer — see the positioning guardrail below.
- "50 team accounts" = read as 50 paying orgs, each with multiple seats, not 50 individual logins. This assumption drives the capacity-audit math and needs confirming — it changes connection-count and Function-concurrency estimates materially.
- Stripe is now live for myBivy — this plan reflects that; several items below were originally scoped as "before Stripe goes live" and are now "now that it's live."

## Why one plan, not two

98% uptime is a loose bar on paper — 14.4 hours of downtime a month, which ordinary Netlify/Supabase reliability clears without heroics. The real threat to that number is a tail event: an account lockout, a lost Supabase project, a GitHub suspension with no second remote — exactly what the backup & contingency plan already inventoried. Executing that plan is most of the work of being able to responsibly promise 98% to team customers. The genuinely new work (usage caps on a shared API key, connection limits under concurrent load, monitoring that would catch an outage) is what a "can we support 50 accounts" review needs anyway. Shared items go first, then the two tracks split.

## Basecamp — shared foundation (do once, this week)

1. Export every Netlify env var (both sites) to a password manager entry.
2. Confirm current Supabase plan tier; start an independent `pg_dump` schedule outside Supabase's own backups.
3. Move AI Coach off Mark's personal Anthropic key; add a dedicated business key with a budget alert and per-org usage caps.
4. Stand up basic uptime monitoring + alerting on mybivy.com and srene.io (nothing watches either site today).
5. Turn on cloud sync (iCloud Drive / Dropbox) for the SRENE.io local folder.

## Track A — Contingency Plan (this month)

- Mirror the GitHub repo (SDHux/DealRoom) to a second host (GitLab/Bitbucket push-mirroring).
- Confirm a local clone is <1 week stale, on a machine that's itself backed up.
- Commit database schema + RLS policies + grants as SQL migration files in the repo.
- Document DNS records for mybivy.com and srene.io outside Netlify's UI.
- Confirm storage bucket contents (avatars/logos) are included in the backup process.

**Ongoing, now that Stripe is live:**
- Document Stripe webhook signing secret + price/product IDs outside the Stripe dashboard.
- Confirm domain registrar (GoDaddy) auto-renew is on and registrar lock is enabled.
- Set up a static "temporarily down" holding page on a second host (Cloudflare Pages/Vercel), DNS-ready — no longer optional with real billing live.

## Track B — Team Version Readiness

### Reality check (updated after reading the actual repo — this is the big correction to the earlier version of this plan)

The earlier draft of this plan treated "does multi-seat exist" as an open question to define before building. It isn't open — **the multi-seat mechanism is already fully built and live in production, for every org, today, at no extra charge:**

- `organization_members` (migration `0002`) already has a three-role model: **owner / admin / member**, with RLS policies that let an owner invite/manage anyone, and an admin invite/manage plain members only.
- `org_invitations` (migration `0010`) is a complete invite-by-email flow — pending invites, role assignment at invite time (never directly to owner), accept-on-signup via `accept_pending_invite()`.
- The Team & Settings modal in `app.jsx` already has a working "Team" tab: invite a teammate by email, pick a role, see/cancel pending invites.

So this is not a "Team Version" build project in the engineering sense. Any org can already add teammates right now. What's actually undefined is the **business/packaging layer** sitting on top of a feature that already works:

- There is no seat cap or seat-based pricing anywhere in the code today. The one live Stripe price (`STRIPE_PRICE_ID`) is flat-rate per org regardless of how many members that org invites. An org could invite 50 people onto the current single paid plan right now and nothing would stop it or charge more.
- `organizations.deal_room_limit` (default 10, migration `0022`) is a real, enforced, per-org DB column with its own trigger (`enforce_deal_room_limit`, `0017`) — but it's a deal-room cap, not a seat cap, and today every org gets the same default regardless of plan.
- There is no "individual" vs. "team" plan distinction in Stripe at all yet — one product, one price, one trial/promo structure for everyone.

**What this changes about scope:** the real work here is a pricing/packaging decision, not a feature build. Two shapes worth deciding between (for Mark, not Claude Code, to decide):
1. **Ride on what exists** — market a "Team" plan that's really just "here's how to invite your team," possibly with a higher `deal_room_limit` and a higher price, using a second Stripe price ID. Very little engineering: mostly a pricing page, a second Stripe Price, and checkout/webhook logic already generalized enough to handle multiple price IDs (worth confirming — `create-checkout-session.mts` currently reads a single `STRIPE_PRICE_ID` env var, so supporting two plans needs at minimum a plan-selection param threaded through checkout).
2. **Add a real seat cap/seat-based price** — meter or cap `organization_members` count per org, enforce it the same way `deal_room_limit` is enforced (a trigger), and price per seat in Stripe. More engineering, more billing complexity (Stripe quantity-based subscriptions), but a more defensible "team" SKU if the goal is per-seat revenue rather than a flat higher tier.

Neither is started. This plan doesn't pick one — that's an open decision for Mark below.

### Define before building (revised)

- **Pricing/packaging decision** (see Reality check above): flat higher-tier plan vs. per-seat pricing. This is the actual open item, not "does multi-seat work."
- Write the manual-refresh caveat into the spec explicitly — myBivy is fetch-on-load, not live-subscription; two reps on the same deal room won't see each other's changes without a refresh.
- **Positioning guardrail:** myBivy's locked target is the rep/buyer working inside the deal room, not a manager reporting on reps. "Team version" should mean shared access for a selling team, not a leader oversight dashboard. Nothing in the existing role model (owner/admin/member) violates this today — admin is an org-management permission, not a reporting/oversight feature — keep it that way.

### Capacity audit — needs repo/dashboard access, not yet run

- Check Supabase connection pooling under concurrent Netlify Function invocations (each invocation opening its own DB connection is the classic way "50 accounts" becomes "connection limit exceeded" — confirm a pooler like Supavisor is in front of it).
- Check Netlify Functions concurrency/timeout limits against the current plan tier.
- Load-test live Stripe webhook handling under concurrent checkouts.
- Now that seats are effectively unlimited per org (see Reality check), stress-test what an org with, say, 20+ members actually does to per-org query load in the app (organization_members lookups, deal room visibility joins) — this wasn't in scope when multi-seat was assumed unbuilt.
- Re-verify the five previously-fixed bugs haven't regressed: stage-renaming task deletion, prospect-preview auth leak, AI Coach/transcript empty responses, avatar cache-busting, stakeholder tag leakage.

### Before flipping it on

- Terms of Service and Privacy Policy live and linked from the product.
- Extend the contingency plan's recovery runbook into a customer-facing incident playbook.
- Confirm the deal-room-per-org default (currently 10) is right for a team-tier customer, and whether team-tier orgs get a different `deal_room_limit` value.
- Finalize the pricing/packaging decision above and, if per-seat, design the seat-cap enforcement trigger and Stripe quantity wiring before writing UI for it.

## Sequencing

- **Phase 0 (this week):** Basecamp, above. Both tracks are blocked on this.
- **Phase 1 (this month):** Track A and Track B run in parallel — Track A is mostly Mark working through vendor account settings; Track B needs the pricing/packaging decision made, then a capacity audit.
- **Phase 2 (before go-live on team accounts):** Stripe docs finalized, ToS/Privacy live, incident playbook written, deal-room/seat limits finalized, then a go/no-go review against this whole list.

## Open decisions needed from Mark

1. Is "50 team accounts" 50 orgs, or 50 total seats?
2. What's the current Supabase plan tier, and what backup retention does it actually include?
3. What's the current Netlify plan tier (Functions concurrency/timeout/bandwidth caps vary by plan)?
4. Is 98% an external promise already made to a prospect, or an internal target being set now?
5. **Pricing/packaging for Team: flat higher-tier plan (simpler, ships faster) or per-seat pricing (more engineering, cleaner unit economics)?** This is the one genuinely new decision this revision surfaces — see Reality check above.
6. Who runs the capacity audit — a Claude Code session with the repo and Supabase dashboard connected, or Mark pulling the specific numbers above?

## What this plan can't tell you yet

The capacity audit items above still need eyes on the actual Supabase dashboard and Netlify plan settings — the codebase side of the "what already exists" question has now been answered directly from the repo (see Reality check), but connection limits, plan tiers, and live load behavior have not been checked. The fastest path to real answers is a Claude Code session with the local repo and, ideally, Supabase project access connected, run against the open decisions above one at a time. Track A doesn't have this problem — it's mostly Mark working through vendor account settings directly.

*Sources: myBivy-backup-contingency-plan.md, business-email-setup.md (project docs); srene-mybivy and myBivy-positioning skill references; direct inspection of `supabase/migrations/0002_organizations_and_membership.sql`, `0010_org_invitations.sql`, `0017_deal_room_limit.sql`, `0022_deal_room_limit_10.sql`, and the Team tab in `app.jsx` (this session, September 12, 2026).*

# Read.ai Webhook Integration — Build Spec

Last updated: September 15, 2026
Status: **Not started.** This is the locked design from a scoping conversation, not yet built. No migrations applied, no functions written.

## Why this doc exists

Reps recording calls with Read.ai (a third-party meeting notetaker, unrelated to Google — see Sources) currently have to manually copy the transcript out of Read.ai and paste it into myBivy's "From Transcript / Notes" onboarding flow (`app.jsx:873`) to build or update a deal room. This spec automates that hand-off via Read.ai's webhook feature, so a call updates the right deal room (or prompts to create one) without the rep doing the copy/paste.

**Team tier only.** This never touches Solo — gated by `organizations.plan_tier`, both in the UI that exposes the setup and in the webhook function itself.

## Locked decisions

1. **Zero deal-room match → prompt to create, never silent auto-create.** A Read.ai call with someone not yet in myBivy surfaces as a dismissible prompt ("Read.ai call with jane@acme.com — create a deal room?"), one click confirms using the existing transcript-extraction flow. Never creates a deal room without the rep's explicit click.
2. **Surfaced via a notification bell.** New UI element — nothing like this exists in the app today (confirmed: no `notification` references anywhere in `app.jsx`). This is real new scope, not wiring into existing infra.
3. **Matched calls update additively only.** A matched call logs the transcript/summary as a new activity entry and proposes new tasks via the existing Claude extraction prompt (`app.jsx:840`). It never overwrites an already-set exec summary, stage, or existing stakeholders — a rep's hand-edits are never silently clobbered.

## Identity: per-rep webhook, not per-org

Read.ai webhooks are created by an individual Read.ai user account, each with its own HMAC signing key — there's no shared "workspace webhook" we can assume reps have access to (that tier requires Read.ai Enterprise admin rights). So each myBivy rep who wants this connects their own Read.ai account individually:

1. Rep opens a new "Read.ai" card in Team Settings.
2. myBivy generates a random `token` and shows them the URL to paste into their own Read.ai webhook config: `https://mybivy.com/api/read-ai-webhook/{token}`
3. Rep copies the signing key Read.ai shows them back into myBivy.
4. Status shows Pending until the first real payload arrives, then Active — mirrors Read.ai's own webhook status language.

This means the incoming request always tells us exactly which org and which rep sent it, without trusting anything in Read.ai's payload — and narrows deal-room matching to just that rep's own pipeline, which avoids cross-rep collisions almost entirely.

## New schema (not yet applied — prospective migration `0047`)

```sql
create table read_ai_webhooks (
  org_id uuid not null references organizations(id),
  user_id uuid not null,  -- references organization_members(user_id)
  token text not null unique,        -- path segment, myBivy-generated
  signing_key text not null,         -- pasted in by the rep from Read.ai
  status text not null default 'pending',  -- pending / active / stopped
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table read_ai_prompts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  user_id uuid not null,             -- the rep this prompt is for
  session_id text not null,          -- Read.ai's session_id, for de-dup
  kind text not null,                -- 'create' | 'disambiguate'
  candidate_emails text[] not null,
  candidate_deal_ids uuid[],         -- populated only for 'disambiguate'
  transcript jsonb not null,         -- stored so "create" can act on it later without re-fetch
  summary text,
  status text not null default 'open',  -- open / dismissed / resolved
  created_at timestamptz not null default now()
);
```

`read_ai_prompts` is what the notification bell reads from. `stakeholders.email` already exists in the current schema — no gap there, confirmed live.

## Matching algorithm

Runs inside the webhook function once the token has resolved to `(org_id, user_id)` and the org has been confirmed to be on a Team plan:

```
1. Verify X-Read-Signature using the stored signing_key (HMAC-SHA256 of the raw body).
   Reject with 401 if it doesn't match.
2. Ignore trigger:"meeting_start" -- only act on "meeting_end" (no report exists yet at start).
3. candidates = payload.participants
     .filter(p => p.email && p.email.toLowerCase() !== payload.owner.email?.toLowerCase())
     .map(p => p.email.toLowerCase())
4. matches = select id from deals
     where assigned_to = :user_id
       and org_id = :org_id
       and archived_at is null
       and exists (
         select 1 from stakeholders
         where stakeholders.deal_id = deals.id
           and lower(stakeholders.email) = any(:candidates)
       )
5. Branch on matches.length:
   0  -> insert read_ai_prompts (kind='create', candidate_emails, transcript, summary)
   1  -> additive update: log transcript/summary as a new activity entry on that deal,
         re-run the app.jsx:840 extraction prompt against the transcript, insert any
         *new* tasks it proposes -- never touch exec_summary, stage, or existing stakeholders.
   2+ -> insert read_ai_prompts (kind='disambiguate', candidate_deal_ids, transcript, summary)
```

Respond 2xx immediately after signature verification; do the Claude extraction call after responding (Read.ai retries on non-2xx, and its 6-attempt retry window shouldn't be spent waiting on an LLM call).

## Netlify function

`netlify/functions/read-ai-webhook.mts` — same shape as `stripe-webhook.mts`:
- Route: `/api/read-ai-webhook/:token`
- Look up token in `read_ai_webhooks` → 404 if unknown.
- Re-check `organizations.plan_tier` is a team tier at request time, not just at setup time (covers a downgrade after the webhook was configured) → no-op with 200 if not.
- Verify signature, branch per the matching algorithm above.

## UI surfaces (all new)

1. **Team Settings → "Read.ai" card**: generate/display the webhook URL, input for the rep to paste their signing key, status pill (Pending/Active/Stopped mirroring Read.ai's own language).
2. **Notification bell**, in the Team topbar (`TPTopbar`) — Admin/Manager/Rep all need this since it's per-rep prompts, not an Admin-only surface. Since the app is fetch-on-load rather than live-subscription (existing architecture constraint — see `srene-mybivy` project notes), the bell's unread count is fetched on load/refresh, not pushed in real time.
3. **Prompt dropdown/panel**: lists open `read_ai_prompts` for the current rep.
   - `create` kind: "Read.ai call with jane@acme.com — create a deal room?" → routes into the existing transcript-extraction onboarding flow, pre-filled with the stored transcript instead of a paste box.
   - `disambiguate` kind: "Read.ai call with jane@acme.com — which deal room?" → picker over `candidate_deal_ids`.
   - Dismiss action sets `status='dismissed'` without acting.

## Explicit non-goals

- No Solo exposure, anywhere — gated at both the settings UI and the function itself.
- No silent deal-room creation.
- No overwriting existing exec summary, stage, or stakeholders on a matched deal.
- No use of Read.ai's REST API/MCP server for this — it's open beta, OAuth-only (no static keys), 10-minute token expiry, unsuited to unattended server-to-server use. Webhooks are the stable, production path Read.ai itself points integrators toward.
- No workspace-level Read.ai webhook — requires Read.ai Enterprise admin rights we can't assume reps have; per-rep user webhooks work on any paid Read.ai plan (Pro and up).

## Build order (proposed)

1. Migration `0047`: `read_ai_webhooks` + `read_ai_prompts` tables, RLS scoped to `org_id`/`user_id` matching the caller.
2. `read-ai-webhook.mts` function: signature verification + matching algorithm, writing prompts/activity but no UI yet — verify with Read.ai's own "Send test request" feature before any UI exists.
3. Team Settings "Read.ai" card: token generation, signing-key capture, status display.
4. Notification bell + prompt panel in `TPTopbar`.
5. Wire the `create` prompt into the existing transcript-extraction flow (reuse `app.jsx:840`'s prompt, fed the stored transcript instead of pasted text).
6. QA: real Read.ai account, real test call, verify signature rejection on a tampered payload, verify Solo orgs get a 200 no-op if a token is somehow hit.

## Sources

- [Getting Started with Webhooks](https://support.read.ai/hc/en-us/articles/16352415827219-Getting-Started-with-Webhooks) — payload schema, HMAC verification, retry behavior, Pro/Enterprise/Enterprise+ plan requirement.
- [Read AI API and MCP Overview](https://support.read.ai/hc/en-us/articles/49379985941523-Read-AI-API-and-MCP-Overview) — why the REST API/MCP path was ruled out for this use case (open beta, OAuth-only, 10-min token expiry).

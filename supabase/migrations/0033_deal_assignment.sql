-- Explicit deal assignment, per TEAM-VERSION-ADMIN-MANAGER-SPEC.md. Separate from
-- created_by (an immutable audit fact -- "who set this deal room up") -- assigned_to is
-- "whose deal room is this right now" and is meant to be reassignable when an account
-- changes hands, without rewriting created_by history.
alter table deals add column assigned_to uuid references auth.users (id) on delete set null;

-- Backfill: every existing deal is currently "assigned" to whoever created it, since
-- that's the closest approximation of today's implicit single-user-org behavior.
update deals set assigned_to = created_by where assigned_to is null;

create index on deals (assigned_to);

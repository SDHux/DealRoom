-- Org-level custom display labels for the 5 fixed sales stages (alignment/demo/eval/
-- decision/formalize). Empty object means "use the built-in defaults" -- no backfill
-- needed, no existing org sees any change until they explicitly rename a stage.
alter table organizations add column stage_labels jsonb not null default '{}'::jsonb;

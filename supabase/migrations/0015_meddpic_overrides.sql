-- MEDDPIC was built fully derived/read-only (from Discovery, Stakeholders, and Action
-- Plan) -- this adds the ability to override any single field with stored text instead,
-- without losing that auto-derivation for fields nobody ever touches. A field with a
-- non-empty entry here is a rep-written override, shown in place of the derived
-- rendering; an absent/empty entry means "keep deriving this one as before."
alter table deals add column meddpic jsonb not null default '{}'::jsonb;

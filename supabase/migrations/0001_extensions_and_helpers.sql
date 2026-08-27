-- Extensions and the one trigger helper with no table dependencies.
-- Helpers that reference specific tables (organization_members, deals, etc.) live in the
-- migration that creates that table, so nothing here forward-references a table that
-- doesn't exist yet.

create extension if not exists pgcrypto;

-- Maintains updated_at on any table that has one; never set by hand.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

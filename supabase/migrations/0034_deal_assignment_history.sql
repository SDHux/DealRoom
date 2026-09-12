-- DEFAULT (flagged per spec's "Readiness to hand this to Claude Code" section, open
-- question 3): logs every reassignment rather than doing a silent field update, since a
-- log is the more conservative of the two options Mark was asked to choose between and
-- costs nothing for orgs that never reassign. Mark can ask for this to be removed, or for
-- reassignment notifications on top of it, on review.
--
-- DB trigger rather than app.jsx-side logging (same reasoning as enforce_active_sequence
-- in 0028): the log has to be true regardless of which code path changes assigned_to, not
-- just the one UI control that exists today.

create table deal_assignment_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  org_id uuid not null,
  previous_assigned_to uuid references auth.users (id) on delete set null,
  new_assigned_to uuid references auth.users (id) on delete set null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),

  constraint deal_assignment_history_deal_org_fk foreign key (deal_id, org_id) references deals (id, org_id) on delete cascade
);

create index on deal_assignment_history (deal_id);
create index on deal_assignment_history (org_id);

alter table deal_assignment_history enable row level security;

-- Reassignment history is manager-facing operational data, same sensitivity tier as
-- prospect_access_attempts (0005) -- owner/admin only, not every member.
create policy deal_assignment_history_select on deal_assignment_history
  for select
  using (current_org_role(org_id) in ('owner', 'admin'));

grant select on public.deal_assignment_history to authenticated;

create or replace function public.log_deal_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is distinct from old.assigned_to then
    insert into deal_assignment_history (deal_id, org_id, previous_assigned_to, new_assigned_to, changed_by)
    values (new.id, new.org_id, old.assigned_to, new.assigned_to, auth.uid());
  end if;
  return new;
end;
$$;

create trigger log_deal_assignment_change
  after update on deals
  for each row execute function public.log_deal_assignment_change();

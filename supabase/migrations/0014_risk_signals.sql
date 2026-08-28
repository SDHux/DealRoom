-- Rules-based risk/health signal layer (spec section 3) -- explicitly NOT ML, plain
-- explainable thresholds only. Pure read-side: a single security_invoker view deriving
-- flags from data that Section 2's event logging now makes real, same posture as
-- document_view_stats (0006) -- no new writes, no new RPCs needed.
--
-- "Deal has been in the same phase for 1 week" is interpreted as "no forward task
-- progress" (max(deal_tasks.updated_at), which the existing set_updated_at trigger
-- keeps current -- see 0001/0004) rather than deals.stage, which is set once at
-- creation and never updated anywhere in the app -- founding this on deals.stage would
-- flag literally every deal past its first week, forever.
--
-- "Buyer disengaged" (a decision-maker stakeholder who hasn't viewed any document)
-- depends on stakeholders.email (0013) being populated -- there's no UI to set it yet,
-- so this flag will simply never fire until the next work item (editable Stakeholders
-- tab) adds that field. Expected, not a bug.
create view public.deal_risk_signals
with (security_invoker = true) as
select
  d.id as deal_id,
  extract(epoch from (now() - coalesce(lv.last_visit, d.created_at)))::int / 86400 as days_since_visit,
  (now() - coalesce(lv.last_visit, d.created_at)) > interval '3 days' as going_cold,
  extract(epoch from (now() - coalesce(lt.last_activity, d.created_at)))::int / 86400 as days_since_task_activity,
  (now() - coalesce(lt.last_activity, d.created_at)) > interval '7 days' as stalled,
  db.name as disengaged_buyer_name
from deals d
left join lateral (select max(started_at) as last_visit from deal_visits where deal_id = d.id) lv on true
left join lateral (select max(updated_at) as last_activity from deal_tasks where deal_id = d.id) lt on true
left join lateral (
  select s.name from stakeholders s
  where s.deal_id = d.id and s.designation = 'decision-maker'
    and not exists (select 1 from document_views dv where dv.stakeholder_id = s.id)
  limit 1
) db on true
where d.archived_at is null;

-- No RLS policy needed on the view itself -- security_invoker means it runs with the
-- caller's own permissions against deals/deal_visits/deal_tasks/stakeholders/
-- document_views, all of which already have correct org-scoped select policies.
grant select on public.deal_risk_signals to authenticated;

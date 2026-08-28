-- Every child table in 0004/0005 was given BOTH a plain single-column FK (e.g.
-- `deal_id references deals(id)`) AND a composite FK (`(deal_id, org_id) references
-- deals(id, org_id)`) for the same parent relationship. PostgREST's nested `.select('*,
-- stakeholders(*)')` embedding can't disambiguate between two valid FK paths connecting
-- the same two tables and fails with PGRST201 ("more than one relationship was found").
--
-- Fix: drop the redundant plain FK on each table and move its ON DELETE behavior onto the
-- composite FK instead (which already enforces the plain-column relationship too, since
-- a composite FK requires all referenced columns to match a row -- deal_id alone can't
-- point at a bad value once (deal_id, org_id) must match an existing (id, org_id) pair).

alter table stakeholders drop constraint stakeholders_deal_id_fkey;
alter table stakeholders drop constraint stakeholders_deal_org_fk;
alter table stakeholders add constraint stakeholders_deal_org_fk
  foreign key (deal_id, org_id) references deals (id, org_id) on delete cascade;

alter table deal_tasks drop constraint deal_tasks_deal_id_fkey;
alter table deal_tasks drop constraint deal_tasks_deal_org_fk;
alter table deal_tasks add constraint deal_tasks_deal_org_fk
  foreign key (deal_id, org_id) references deals (id, org_id) on delete cascade;

alter table documents drop constraint documents_deal_id_fkey;
alter table documents drop constraint documents_deal_org_fk;
alter table documents add constraint documents_deal_org_fk
  foreign key (deal_id, org_id) references deals (id, org_id) on delete cascade;

alter table prospect_sessions drop constraint prospect_sessions_deal_id_fkey;
alter table prospect_sessions drop constraint prospect_sessions_deal_org_fk;
alter table prospect_sessions add constraint prospect_sessions_deal_org_fk
  foreign key (deal_id, org_id) references deals (id, org_id) on delete cascade;

alter table document_views drop constraint document_views_document_id_fkey;
alter table document_views drop constraint document_views_doc_org_fk;
alter table document_views add constraint document_views_doc_org_fk
  foreign key (document_id, org_id) references documents (id, org_id) on delete cascade;

alter table deal_visits drop constraint deal_visits_deal_id_fkey;
alter table deal_visits drop constraint deal_visits_deal_org_fk;
alter table deal_visits add constraint deal_visits_deal_org_fk
  foreign key (deal_id, org_id) references deals (id, org_id) on delete cascade;

alter table deal_visit_actions drop constraint deal_visit_actions_visit_id_fkey;
alter table deal_visit_actions drop constraint deal_visit_actions_visit_org_fk;
alter table deal_visit_actions add constraint deal_visit_actions_visit_org_fk
  foreign key (visit_id, org_id) references deal_visits (id, org_id) on delete cascade;

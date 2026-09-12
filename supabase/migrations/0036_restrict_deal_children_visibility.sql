-- Build-order step 3 from TEAM-VERSION-ADMIN-MANAGER-SPEC.md: "verify nothing else
-- silently assumed org-wide member visibility." Every deals-adjacent table listed there
-- (stakeholders, deal_tasks, documents, deal_experience_items) plus the activity/session
-- tables added in 0005 all select on a bare is_org_member(org_id) -- org-wide, exactly
-- like the old deals_select policy 0035 just replaced. Tightened here the same way: a
-- member only sees rows under a deal assigned to them; owner/admin keep full visibility.
-- prospect_access_attempts (0005) is already owner/admin-only and needs no change.

-- can_manage_deal (0003): checked BEFORE finding this gap, this function only tested
-- created_by = auth.uid(), never assigned_to -- a deal reassigned from its creator to a
-- different rep would leave the new assignee unable to manage it (only the original
-- creator or owner/admin could). Fixed to accept the deal's current assignee.
--
-- created_by is dropped from this grant entirely, not just supplemented -- once
-- assigned_to exists (and defaults to created_by at insert, 0033), it fully subsumes the
-- "creator manages their own new deal" case. Keeping created_by here as well would have
-- reopened exactly the gap deals_select (0035) just closed: a rep who created a deal,
-- had it reassigned away, and can no longer even see it would still be able to write to
-- it directly (update/delete the deal, or insert/edit its stakeholders/tasks/documents)
-- via this function, since every write policy in 0003/0004/0028/0012 delegates to it.
create or replace function public.can_manage_deal(p_deal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.deals
    where id = p_deal_id
      and (
        assigned_to = auth.uid()
        or current_org_role(org_id) in ('owner', 'admin')
      )
  );
$$;

-- can_view_deal: the read-side counterpart to can_manage_deal, extracted so the
-- "owner/admin see everything, a member sees only their assigned deal" rule lives in
-- exactly one place -- every child-table SELECT policy below calls this instead of each
-- hand-inlining its own copy of the same exists(...) predicate. Same shape as
-- deals_select (0035), which stays inline there since it's the base case with no join to
-- perform; everything below needs to reach a deal_id (sometimes two hops away) first, so
-- there's still per-table plumbing, but the actual visibility rule itself is one function.
create or replace function public.can_view_deal(p_deal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.deals
    where id = p_deal_id
      and (
        assigned_to = auth.uid()
        or current_org_role(org_id) in ('owner', 'admin')
      )
  );
$$;

drop policy stakeholders_select on stakeholders;
create policy stakeholders_select on stakeholders
  for select
  using (can_view_deal(deal_id));

drop policy deal_tasks_select on deal_tasks;
create policy deal_tasks_select on deal_tasks
  for select
  using (can_view_deal(deal_id));

drop policy documents_select on documents;
create policy documents_select on documents
  for select
  using (can_view_deal(deal_id));

drop policy deal_experience_items_select on deal_experience_items;
create policy deal_experience_items_select on deal_experience_items
  for select
  using (can_view_deal(deal_id));

drop policy prospect_sessions_select on prospect_sessions;
create policy prospect_sessions_select on prospect_sessions
  for select
  using (can_view_deal(deal_id));

drop policy deal_visits_select on deal_visits;
create policy deal_visits_select on deal_visits
  for select
  using (can_view_deal(deal_id));

-- document_views has no deal_id of its own -- one join to find it, then the same
-- single can_view_deal call as every other policy above.
drop policy document_views_select on document_views;
create policy document_views_select on document_views
  for select
  using (
    exists (
      select 1 from documents doc
      where doc.id = document_views.document_id and can_view_deal(doc.deal_id)
    )
  );

-- deal_visit_actions has no deal_id of its own -- one join to find it, then can_view_deal.
drop policy deal_visit_actions_select on deal_visit_actions;
create policy deal_visit_actions_select on deal_visit_actions
  for select
  using (
    exists (
      select 1 from deal_visits v
      where v.id = deal_visit_actions.visit_id and can_view_deal(v.deal_id)
    )
  );

-- Storage (0012): deal_documents_select was org-folder-scoped (is_org_member on the
-- org_id path segment) even though the path also encodes deal_id and every other
-- operation on this bucket (insert/update/delete) already uses the deal-scoped
-- can_manage_deal. Same gap as the table-level policies above, just one layer down --
-- fixed to call can_view_deal, matching the read/write split used everywhere else now
-- (can_manage_deal is a write-permission check; reusing it here would have tied file
-- visibility to write permission instead of to the same read rule as the documents table).
drop policy deal_documents_select on storage.objects;
create policy deal_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deal-documents'
    and (
      can_view_deal(((storage.foldername(name))[2])::uuid)
      or is_verified_prospect(((storage.foldername(name))[2])::uuid)
    )
  );

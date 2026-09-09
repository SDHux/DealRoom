-- Per-task scheduling action (replaces the earlier global "Schedule a call" Welcome-tab
-- button, never shipped as a separate concept -- this is the only Calendly-on-tasks column
-- needed). Reuses profiles.calendly_url (0025) as the actual booking link; this just marks
-- which tasks should surface a "Schedule this" action to the prospect.
alter table deal_tasks add column calendly_enabled boolean not null default false;

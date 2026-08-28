-- Adds "Product Demo" as a real, selectable task phase. It previously existed only as a
-- narrative label on the ProcessTimeline UI (mapped onto "Value Alignment" tasks), not as
-- something a rep could actually pick when creating a task.

alter table deal_tasks drop constraint deal_tasks_phase_check;
alter table deal_tasks add constraint deal_tasks_phase_check
  check (phase in ('Value Alignment', 'Product Demo', 'Trial Sessions', 'Business Case', 'Paper Process'));

-- Lowers the base-plan deal room cap for newly-created orgs only, from 25 to 10. Existing
-- orgs (including test accounts like "Debug Tester", "TesterStripe") keep whatever
-- deal_room_limit they already have -- deliberately no UPDATE against existing rows here.
alter table organizations alter column deal_room_limit set default 10;

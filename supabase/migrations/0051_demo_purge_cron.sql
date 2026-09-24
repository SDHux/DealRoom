create extension if not exists pg_cron;

-- Hourly sweep of expired demo workspaces (start-demo also purges lazily on every start).
select cron.schedule('purge-expired-demos', '17 * * * *', $$select public.purge_expired_demos()$$);

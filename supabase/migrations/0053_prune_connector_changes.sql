-- =============================================================================
-- The undo log is pruned with the other logs.
--
-- connector_changes keeps a whole copy of every row an AI deleted, notes
-- included, and nothing ever removed it. Ninety days, like delivery_log: an
-- undo older than that is not one anybody is waiting to take.
-- =============================================================================

create or replace function private.retention_tick()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.delivery_log where created_at < now() - interval '90 days';
  delete from public.ai_usage where local_day < to_char(now() - interval '60 days', 'YYYY-MM-DD');
  delete from public.daily_summaries where local_day < to_char(now() - interval '60 days', 'YYYY-MM-DD');
  delete from public.connector_changes where created_at < now() - interval '90 days';
$$;

revoke all on function private.retention_tick() from public;

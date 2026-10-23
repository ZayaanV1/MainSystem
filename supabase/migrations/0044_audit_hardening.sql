-- =============================================================================
-- 0044_audit_hardening.sql — what the 22 Oct 2026 audit found in the database.
--
-- 1. THE ANON ROLE HOLDS EVERY PRIVILEGE ON EVERY TABLE.
--
-- Supabase grants `anon` full table privileges on `public` by default, and row
-- level security is what actually stops it. That held: every table has RLS and
-- every policy is scoped to the account. But it makes RLS the only wall, so one
-- future table created without a policy would be readable and writable by
-- anyone holding the public key. Nothing in this app is meant to be reached
-- signed out except through the Auth API and the functions, which use the
-- service role, so `anon` needs no table privileges at all. Revoked, and the
-- default for tables created later is changed to match.
--
-- 2. SEVEN FOREIGN KEYS HAD NO INDEX.
--
-- Deleting a course scans assignments, events, series and memory for rows
-- that reference it, and every list filtered by course does the same. Free at
-- a few hundred rows, a visible pause later.
--
-- 3. NOTHING EVER LEFT THE LOG TABLES.
--
-- delivery_log, ai_usage and daily_summaries grow forever. A weekly job now
-- removes rows older than their useful life. Chat messages are NOT touched:
-- that is the person's own history, not an operational log.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
    alter default privileges in schema public revoke all on tables from anon;
    alter default privileges in schema public revoke all on sequences from anon;
    -- Supabase sets these defaults for the role that runs migrations.
    if exists (select 1 from pg_roles where rolname = 'postgres') then
      alter default privileges for role postgres in schema public revoke all on tables from anon;
      alter default privileges for role postgres in schema public revoke all on sequences from anon;
    end if;
  end if;
end;
$$;

create index if not exists assignments_course on public.assignments (course_id);
create index if not exists subtasks_user on public.subtasks (user_id);
create index if not exists events_course on public.events (course_id);
create index if not exists assignment_series_course on public.assignment_series (course_id);
create index if not exists telegram_link_codes_user on public.telegram_link_codes (user_id);
create index if not exists memory_facts_course on public.memory_facts (course_id);
create index if not exists class_series_course on public.class_series (course_id);

-- Retention. 90 days of delivery history is more than any diagnosis needs, and
-- the one-digest-per-day rule only ever looks at today.
create or replace function private.retention_tick()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.delivery_log where created_at < now() - interval '90 days';
  delete from public.ai_usage where local_day < to_char(now() - interval '60 days', 'YYYY-MM-DD');
  delete from public.daily_summaries where local_day < to_char(now() - interval '60 days', 'YYYY-MM-DD');
$$;

revoke all on function private.retention_tick() from public;

do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'life-planner-retention';
    perform cron.schedule('life-planner-retention', '23 3 * * 0', 'select private.retention_tick()');
  end if;
end;
$$;

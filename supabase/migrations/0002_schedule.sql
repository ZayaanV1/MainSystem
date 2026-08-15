-- =============================================================================
-- 0002_schedule.sql — the scheduled job that drives the digest.
--
-- pg_cron schedules in UTC and has no notion of Montreal, let alone of Montreal
-- twice a year. Rather than encode 11:00Z and 12:00Z in a crontab that would
-- need editing every March and November, this job runs every 15 minutes and the
-- edge function decides whether it is currently 07:00 for the user.
--
-- Three things fall out of that, all of them wanted:
--   - DST is handled once, in tested TypeScript, instead of in a crontab.
--   - A digest missed because the scheduler was down still goes out, within a
--     three-hour catch-up window.
--   - The project never goes 7 days without database activity, so the free tier
--     cannot pause it. A project that pauses during a bad week takes the digest
--     down exactly when it is load-bearing.
-- =============================================================================

create extension if not exists supabase_vault with schema vault;

-- Secrets live in Vault, encrypted, rather than in a table anyone with a
-- connection could select. The setup script writes them; nothing reads them
-- except the function below, which runs as definer.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- private.dispatch_tick()
--
-- Deliberately defensive. If the secrets are not configured yet — which is the
-- state between running the migrations and running the setup script — it must
-- do nothing quietly rather than raise every 15 minutes and fill the logs with
-- an error that is not actually a problem.
-- -----------------------------------------------------------------------------
create or replace function private.dispatch_tick()
returns void
language plpgsql
security definer
set search_path = private, public, vault, net
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'dispatch_url' limit 1;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret' limit 1;

  if v_url is null or v_secret is null then
    -- Not configured yet. Nothing to do, and nothing worth complaining about.
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function private.dispatch_tick() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- The schedule itself.
--
-- Unscheduled first so that re-running migrations is idempotent rather than
-- accumulating duplicate jobs — four identical 07:00 pushes would be a bug that
-- only shows up on a phone.
-- -----------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('life-planner-dispatch');
exception
  when others then null; -- not scheduled yet, which is fine
end;
$$;

select cron.schedule(
  'life-planner-dispatch',
  '*/15 * * * *',
  $$select private.dispatch_tick()$$
);

-- -----------------------------------------------------------------------------
-- public.setup_dispatch()
--
-- Writes the two Vault secrets the tick function reads. Exists because Vault
-- lives behind SQL and the setup script talks to the project over HTTP; without
-- it, configuration would mean pasting SQL into the dashboard by hand.
--
-- Locked to service_role. That role already bypasses RLS and can do anything,
-- so this grants no new privilege — but anon and authenticated must never reach
-- it, or the browser could rewrite where the scheduler posts.
-- -----------------------------------------------------------------------------
create or replace function public.setup_dispatch(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  -- vault.create_secret raises on a duplicate name, so replace when present.
  if exists (select 1 from vault.secrets where name = 'dispatch_url') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'dispatch_url'), p_url);
  else
    perform vault.create_secret(p_url, 'dispatch_url', 'dispatch endpoint for pg_cron');
  end if;

  if exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'cron_secret'), p_secret);
  else
    perform vault.create_secret(p_secret, 'cron_secret', 'shared secret for the dispatch endpoint');
  end if;
end;
$$;

revoke all on function public.setup_dispatch(text, text) from public, anon, authenticated;
grant execute on function public.setup_dispatch(text, text) to service_role;

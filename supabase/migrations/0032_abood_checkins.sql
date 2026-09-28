-- Abood texts first.
--
-- When someone who talks to Abood by text goes quiet, Abood checks in once —
-- the way a friend would — and not again until they reply. The hourly tick
-- decides who is due; the checkin function writes and sends the message.

alter table public.app_settings
  add column if not exists abood_checkins boolean not null default true;

-- How often. Null means "when I have gone quiet" (about a day); a number
-- means every that many hours. The window is local hours, from inclusive to
-- until exclusive (8 and 24 is 8am to midnight).
alter table public.app_settings
  add column if not exists abood_checkin_every_hours smallint
    check (abood_checkin_every_hours is null or abood_checkin_every_hours between 1 and 72),
  add column if not exists abood_checkin_from smallint not null default 10
    check (abood_checkin_from between 0 and 23),
  add column if not exists abood_checkin_until smallint not null default 21
    check (abood_checkin_until between 1 and 24);

-- Marks a message Abood sent unprompted, so a second check-in is never sent
-- into a silence the first one has not broken.
alter table public.chat_messages
  add column if not exists checkin boolean not null default false;

-- Messages waiting for the Mac bridge to send. iMessage can only be sent from
-- the Mac, so anything Abood starts goes here and the bridge collects it.
-- Service role only: no policies, so no client can read or write it.
create table if not exists public.imessage_outbox (
  id bigserial primary key,
  handle text not null,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.imessage_outbox enable row level security;

create or replace function private.checkin_tick()
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
    return;
  end if;

  perform net.http_post(
    url     := replace(v_url, '/functions/v1/dispatch', '/functions/v1/checkin'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.checkin_tick() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('life-planner-checkin');
exception
  when others then null;
end;
$$;

-- Hourly, off the hour so it does not land on top of the digest and feeds.
select cron.schedule('life-planner-checkin', '17 * * * *', $$select private.checkin_tick()$$);

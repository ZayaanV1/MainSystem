-- =============================================================================
-- 0001_foundation.sql — Phase 0 infrastructure.
--
-- This migration deliberately contains NO feature tables. Assignments, events,
-- courses and the checklist belong to Phase 1 and land in their own migration.
-- Phase 0 exists to prove one thing: that a scheduled server job can put a
-- notification on the phone. Everything here serves that, plus the settings and
-- audit trail the delivery pipeline needs to be diagnosable.
--
-- Every table has RLS enabled and every policy is keyed to auth.uid(). There is
-- one user, but "one user" is not a security model — an anon key is public by
-- construction and ships in the client bundle.
--
-- The edge function talks to this schema with the service role key, which
-- bypasses RLS by design. That key must never reach the browser.
-- =============================================================================

-- pg_cron schedules the digest; pg_net lets a scheduled job call an edge
-- function over HTTP. Both are available on the Supabase free tier.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

-- Keeps updated_at honest without every caller remembering to set it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- app_settings — one row per user. Created on signup by the trigger below.
--
-- Digest timing lives here rather than in the cron expression because pg_cron
-- schedules in UTC and 07:00 in Montreal is 11:00Z for half the year and 12:00Z
-- for the other half. The scheduler therefore runs often and dumbly, and this
-- table is what the edge function consults to decide whether it is actually
-- 07:00 for the user right now. DST is handled in one place, in code, with
-- tests — not smeared across a crontab.
-- -----------------------------------------------------------------------------
create table public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,

  timezone text not null default 'America/Toronto',

  -- Digest fires at this local wall-clock time.
  digest_hour smallint not null default 7 check (digest_hour between 0 and 23),
  digest_minute smallint not null default 0 check (digest_minute between 0 and 59),
  digest_enabled boolean not null default true,

  -- Lookahead windows, in days. Both configurable per the Phase 2 spec; seeded
  -- here so the digest builder never has to invent a default.
  assignment_window_days smallint not null default 7 check (assignment_window_days between 1 and 90),
  event_window_days smallint not null default 14 check (event_window_days between 1 and 90),

  -- Proximity thresholds, in days. Editable per the Phase 1 spec.
  -- Overdue is implicit: anything past due and not done.
  critical_days smallint not null default 2,
  urgent_days smallint not null default 5,
  approaching_days smallint not null default 14,

  -- A global visual state, not a filter. Stored server-side so it survives a
  -- reinstall — the day you need this is not the day to rediscover the toggle.
  low_battery boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- notification_channels — the swappable delivery layer, as data.
--
-- The digest builder never reads this table. It produces a message; the
-- delivery layer reads this to decide where the message goes. Adding Web Push
-- alongside Telegram is a row here plus a new adapter module, not a change to
-- any digest logic. That separation is the whole reason Phase 0 can proceed
-- without knowing whether iOS Web Push will survive its soak test.
--
-- `config` holds only non-secret, per-user routing data — a Telegram chat_id, a
-- push endpoint. Shared secrets (the bot token, the VAPID private key) live in
-- edge function environment variables, never in a row.
-- -----------------------------------------------------------------------------
create type public.channel_kind as enum ('telegram', 'webpush');

create table public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind public.channel_kind not null,
  config jsonb not null default '{}'::jsonb,

  enabled boolean not null default true,

  -- Lower number wins. Telegram starts at 10 and Web Push enters at 20; if Web
  -- Push passes its soak the two swap, and nothing else in the app changes.
  priority smallint not null default 100,

  -- Set when a send fails in a way that means this channel is dead rather than
  -- merely unlucky — a Web Push endpoint returning 404/410, a Telegram bot
  -- blocked by the user. A dead channel is skipped and surfaced in the UI.
  failed_at timestamptz,
  failure_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger notification_channels_touch
  before update on public.notification_channels
  for each row execute function public.touch_updated_at();

create index notification_channels_dispatch_idx
  on public.notification_channels (user_id, enabled, priority)
  where failed_at is null;

-- -----------------------------------------------------------------------------
-- push_subscriptions — Web Push endpoints, one row per installed device.
--
-- Separate from notification_channels because these rot. iOS silently
-- invalidates a subscription when it offloads the PWA, on some OS updates, and
-- if the user removes and re-adds the home screen icon. The client re-subscribes
-- on every launch and upserts here; the delivery layer prunes anything the push
-- service rejects with 404 or 410.
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  endpoint text not null,
  p256dh text not null,
  auth text not null,

  -- Free-text note about which device this is, so a stale row is identifiable.
  user_agent text,

  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, endpoint)
);

create trigger push_subscriptions_touch
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- delivery_log — every send attempt, successful or not.
--
-- This exists because of a rule in the spec: silence is indistinguishable from
-- a broken pipeline. That applies to the infrastructure as much as the content.
-- A Web Push subscription can die quietly and the only symptom is that the
-- 07:00 digest stops arriving — which reads exactly like a calm week.
--
-- It also provides idempotency. The scheduler runs every 15 minutes and is
-- expected to fire more than once inside the digest window; `local_day` plus
-- `kind` is what stops the same morning's digest being sent twice.
-- -----------------------------------------------------------------------------
create type public.delivery_kind as enum ('digest', 'test', 'escalation', 'reminder');
create type public.delivery_status as enum ('sent', 'failed', 'skipped');

create table public.delivery_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind public.delivery_kind not null,
  channel public.channel_kind,

  -- The user's LOCAL calendar day this delivery belongs to, 'YYYY-MM-DD'.
  -- Text, not date, because it is computed in the app's timezone and must not
  -- be reinterpreted by the database's own notion of a day.
  local_day text not null,

  status public.delivery_status not null,
  error text,

  -- What was actually sent, so a wrong digest can be diagnosed after the fact
  -- rather than reconstructed from memory.
  payload jsonb,

  created_at timestamptz not null default now()
);

-- One digest per local day, per user. The scheduler can fire as often as it
-- likes; this constraint is what makes that safe.
create unique index delivery_log_one_digest_per_day
  on public.delivery_log (user_id, kind, local_day)
  where kind = 'digest' and status = 'sent';

create index delivery_log_recent_idx
  on public.delivery_log (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Row level security.
--
-- Enabled on every table, with an explicit policy per operation. No table is
-- readable without a matching auth.uid(), which means the public anon key in
-- the client bundle grants access to nothing on its own.
-- -----------------------------------------------------------------------------

alter table public.app_settings enable row level security;
alter table public.notification_channels enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.delivery_log enable row level security;

create policy "own settings" on public.app_settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own channels" on public.notification_channels
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The delivery log is read-only to the client. Rows are written by the edge
-- function under the service role. The app displays this; it never authors it.
create policy "read own delivery log" on public.delivery_log
  for select to authenticated
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- New user bootstrap.
--
-- Creates the settings row on signup so the app never has to cope with a user
-- who exists but has no configuration. SECURITY DEFINER because it runs inside
-- the auth schema's insert, where there is no auth.uid() yet.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

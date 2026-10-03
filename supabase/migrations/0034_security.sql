-- Security and tenancy, Oct 2026.
--
-- Found by the Phase A audit and confirmed against production with
-- has_function_privilege: two SECURITY DEFINER functions took the user id from
-- the caller, never compared it with auth.uid(), and were executable by `anon`
-- — so anyone holding the public key in the bundle could read or rotate
-- another account's calendar-feed token, or spend its AI budget. Supabase
-- grants EXECUTE on every new public function to anon and authenticated by
-- default; `revoke ... from public` alone does not undo that.
--
-- Also here: the API key columns become truly write-only, and the iMessage
-- bridge stops being one global row every account could read and link to.

-- -----------------------------------------------------------------------------
-- 1. The calendar-feed token: your own account, never a parameter.
-- -----------------------------------------------------------------------------
drop function if exists public.ensure_ics_token(uuid, boolean);

create or replace function public.ensure_ics_token(p_rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  token text;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select ics_token into token from public.app_settings where user_id = caller;

  if token is null or p_rotate then
    -- url-safe base64 of 32 random bytes.
    token := replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_');
    token := replace(token, '=', '');

    insert into public.app_settings (user_id, ics_token)
    values (caller, token)
    on conflict (user_id) do update set ics_token = excluded.ics_token;
  end if;

  return token;
end;
$$;

revoke all on function public.ensure_ics_token(boolean) from public, anon;
grant execute on function public.ensure_ics_token(boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Counting AI use is the edge function's job, and only its job.
-- -----------------------------------------------------------------------------
revoke all on function public.record_ai_use(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_ai_use(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Nothing privileged is callable without signing in.
-- -----------------------------------------------------------------------------
revoke all on function public.delete_own_account() from anon;
-- A trigger function; calling it directly only errors, but it has no reason to
-- be callable at all. Triggers do not check EXECUTE when they fire.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. API keys: written by the account, never read back by it.
--
-- The app checked whether a key was set by selecting the key, so the raw
-- Gemini and Groq keys reached the browser on every Settings open while the
-- copy said the app never reads them back. Column privileges make the promise
-- true: the table's other columns stay readable, the two keys do not, and a
-- yes/no function answers the only question the app has.
--
-- Postgres ignores a column revoke while a table-wide grant stands, so the
-- table grant is replaced with an explicit column list. A new app_settings
-- column must be added here to be readable — and a test fails if it is not.
-- -----------------------------------------------------------------------------
revoke select on public.app_settings from anon, authenticated;
grant select (
  user_id, timezone, digest_hour, digest_minute, digest_enabled,
  assignment_window_days, event_window_days, critical_days, urgent_days,
  approaching_days, low_battery, created_at, updated_at, ics_token,
  weekly_review_enabled, weekly_review_weekday, onboarded_at, abood_checkins,
  abood_checkin_every_hours, abood_checkin_from, abood_checkin_until
) on public.app_settings to authenticated;

create or replace function public.own_key_status()
returns table (gemini boolean, groq boolean)
language sql
stable
security definer
set search_path = public
as $$
  select gemini_api_key is not null, groq_api_key is not null
    from public.app_settings
   where user_id = auth.uid()
$$;

revoke all on function public.own_key_status() from public, anon;
grant execute on function public.own_key_status() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The iMessage bridge belongs to an account.
--
-- It was one row ("a deployment has one bridge") that every signed-in account
-- could read: each saw the bridge's Apple ID address and a Connect button, and
-- a stranger who linked a phone would have been answered by the owner's Mac.
--
-- Now each account can run its own bridge. Settings issues a bridge key, shown
-- once; only its hash is stored. The edge function finds the account from the
-- key, and answers, links and queues texts for that account alone.
-- -----------------------------------------------------------------------------
create table if not exists public.imessage_bridges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text unique,
  address text check (address is null or length(address) <= 200),
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

alter table public.imessage_bridges enable row level security;

drop policy if exists "read own bridge" on public.imessage_bridges;
create policy "read own bridge" on public.imessage_bridges
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "remove own bridge" on public.imessage_bridges;
create policy "remove own bridge" on public.imessage_bridges
  for delete to authenticated using (auth.uid() = user_id);

-- The hash is not secret, but nothing on the client needs it.
revoke all on public.imessage_bridges from anon, authenticated;
grant select (user_id, address, last_seen, created_at) on public.imessage_bridges to authenticated;
grant delete on public.imessage_bridges to authenticated;

create or replace function public.issue_bridge_token()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  token text;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- 244 random bits from two v4 uuids, hex only so it survives any shell.
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.imessage_bridges (user_id, token_hash)
  values (caller, encode(sha256(convert_to(token, 'UTF8')), 'hex'))
  on conflict (user_id) do update set token_hash = excluded.token_hash;

  return token;
end;
$$;

revoke all on function public.issue_bridge_token() from public, anon;
grant execute on function public.issue_bridge_token() to authenticated;

-- Texts queued for a bridge now say whose they are, so a bridge only ever
-- collects its own account's.
alter table public.imessage_outbox
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

update public.imessage_outbox o
   set user_id = l.user_id
  from public.imessage_links l
 where l.handle = o.handle and o.user_id is null;

-- Anything left belongs to no linked handle and could never be delivered.
delete from public.imessage_outbox where user_id is null;

alter table public.imessage_outbox alter column user_id set not null;

create index if not exists imessage_outbox_user on public.imessage_outbox (user_id);

drop table if exists public.imessage_bridge;

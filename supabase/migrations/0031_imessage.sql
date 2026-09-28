-- Abood by iMessage, through a bridge running on a Mac.
--
-- Apple offers no iMessage API, so a small program on a Mac signed into
-- Messages reads new messages and sends replies (bridge/imessage). It talks
-- to the imessage edge function with a shared secret; the function does the
-- rest exactly as the Telegram door does.

alter table public.chat_messages drop constraint if exists chat_messages_via_check;
alter table public.chat_messages
  add constraint chat_messages_via_check check (via in ('app', 'telegram', 'imessage'));

alter table public.memory_facts drop constraint if exists memory_facts_source_check;
alter table public.memory_facts
  add constraint memory_facts_source_check check (source in ('app', 'telegram', 'imessage'));

-- Which phone number or Apple ID belongs to which account. A handle joins an
-- account only by texting a one-time code that account made, the same rule
-- as Telegram: knowing someone's number links nothing.
create table if not exists public.imessage_links (
  handle text primary key check (length(handle) between 3 and 200),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists imessage_links_user on public.imessage_links (user_id);

alter table public.imessage_links enable row level security;

drop policy if exists "read own imessage links" on public.imessage_links;
create policy "read own imessage links" on public.imessage_links
  for select using (auth.uid() = user_id);
drop policy if exists "remove own imessage links" on public.imessage_links;
create policy "remove own imessage links" on public.imessage_links
  for delete using (auth.uid() = user_id);

-- The bridge's heartbeat: the address people text, and when the Mac last
-- checked in. One row — a deployment has one bridge. Settings reads it to say
-- whether the Mac is actually up, because a bridge that is off looks exactly
-- like an Abood that is ignoring you.
create table if not exists public.imessage_bridge (
  id smallint primary key default 1 check (id = 1),
  address text,
  last_seen timestamptz
);

alter table public.imessage_bridge enable row level security;

drop policy if exists "anyone signed in sees the bridge" on public.imessage_bridge;
create policy "anyone signed in sees the bridge" on public.imessage_bridge
  for select to authenticated using (true);

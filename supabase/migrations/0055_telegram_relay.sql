-- Telegram answered by Claude on the account's Mac (12 Nov 2026).
--
-- Telegram calls a webhook, so its answers were always written by the shared
-- free models. When an account's Mac bridge says it answers with Claude
-- (imessage_bridges.relay_until in the future, renewed every few seconds while
-- it polls), the webhook queues the message here instead and the bridge
-- answers it the same way it answers an iMessage. A Mac that stops polling
-- lets relay_until lapse, and Telegram goes back to answering itself.

alter table public.imessage_bridges add column if not exists relay_until timestamptz;

-- Service role only: no policies, so no client can read or write it.
create table if not exists public.telegram_inbox (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  text text not null check (length(text) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.telegram_inbox enable row level security;
revoke all on public.telegram_inbox from anon, authenticated;
create index if not exists telegram_inbox_user on public.telegram_inbox (user_id, id);

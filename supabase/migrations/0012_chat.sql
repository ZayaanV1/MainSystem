-- =============================================================================
-- 0012_chat.sql — Phase 5 conversation state and shared-quota accounting.
--
-- Two tables, and the second one is the less obvious half of the feature.
--
-- The chatbot and the diet parser share one free-tier quota. Running out is a
-- normal Tuesday, and the two are not equally important: logging food is a
-- thing the app exists to do, and asking it a question is a convenience. So
-- usage is counted, and the chatbot stops before the parser does rather than
-- both discovering the wall at once, halfway through a meal.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- chat_messages — the conversation, kept.
--
-- Persisted because a chatbot that forgets is a chatbot you re-explain
-- yourself to, and re-explaining is the friction this whole app exists to
-- remove. Also because "what did it tell me on Tuesday" is a real question
-- when the answer was about a deadline.
-- -----------------------------------------------------------------------------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  role text not null check (role in ('user', 'assistant')),
  content text not null,

  -- What the model proposed, if anything, and whether it was carried out.
  -- Kept on the message rather than in a separate table so the conversation
  -- reads back complete: a proposal that was declined is part of the history.
  proposed_action jsonb,
  action_taken boolean not null default false,

  -- Which of the user's own rows the answer was drawn from. The UI renders
  -- these from the database rather than from the model's prose, so a wrong
  -- sentence cannot produce a wrong deadline on screen.
  referenced_ids text[],

  created_at timestamptz not null default now()
);

create index chat_messages_recent on public.chat_messages (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- ai_usage — one row per user per local day per caller.
--
-- Local day, not UTC, because the quota question the user has is "have I used
-- up today", and their today is America/Toronto.
-- -----------------------------------------------------------------------------
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  local_day text not null check (local_day ~ '^\d{4}-\d{2}-\d{2}$'),
  -- 'chat' or 'parse'. Text rather than an enum so adding a third caller is
  -- not a migration.
  kind text not null,
  count integer not null default 0 check (count >= 0),

  updated_at timestamptz not null default now(),

  unique (user_id, local_day, kind)
);

-- -----------------------------------------------------------------------------
-- Counting a request.
--
-- SECURITY DEFINER so the edge function can record usage for the calling user
-- without the service role having to be trusted with a general write path, and
-- so the increment is atomic rather than a read-then-write that loses races.
-- -----------------------------------------------------------------------------
create or replace function public.record_ai_use(p_user_id uuid, p_local_day text, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.ai_usage (user_id, local_day, kind, count)
  values (p_user_id, p_local_day, p_kind, 1)
  on conflict (user_id, local_day, kind)
  do update set count = ai_usage.count + 1, updated_at = now()
  returning count into new_count;

  return new_count;
end;
$$;

alter table public.chat_messages enable row level security;
alter table public.ai_usage enable row level security;

create policy "own chat messages" on public.chat_messages
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Read-only to the app: the count is written by the function above, and a
-- client that could edit it could edit its way around the reserve.
create policy "read own ai usage" on public.ai_usage
  for select to authenticated using (auth.uid() = user_id);

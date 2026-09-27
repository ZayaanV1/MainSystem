-- Abood's memory, and Abood on Telegram.
--
-- memory_facts is the long-term half of the chatbot's memory: short
-- third-person statements learned from what a person says ("Works at the
-- library on Saturday mornings"), each with an embedding so a question can
-- recall the facts relevant to it rather than all of them. The short-term
-- half is the chat transcript, which already exists.
--
-- Per account, like everything else: a second person's facts must never be
-- able to reach the first person's prompt, so every function here takes the
-- user id and filters on it, even though only the service role calls them.

create extension if not exists vector with schema extensions;

create table if not exists public.memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fact text not null check (length(trim(fact)) between 8 and 200),
  -- Nullable: a fact learned while embeddings were down is still worth
  -- keeping, and recall falls back to recency for it.
  embedding extensions.vector(768),
  source text not null default 'app' check (source in ('app', 'telegram')),
  created_at timestamptz not null default now()
);

create unique index if not exists memory_facts_unique
  on public.memory_facts (user_id, lower(fact));
create index if not exists memory_facts_recent
  on public.memory_facts (user_id, created_at desc);

alter table public.memory_facts enable row level security;

-- A person can see and delete what is remembered about them. They cannot
-- write facts directly; facts arrive only through the chatbot, which is the
-- thing that has to be able to explain where each one came from.
drop policy if exists "read own memory" on public.memory_facts;
create policy "read own memory" on public.memory_facts
  for select using (auth.uid() = user_id);
drop policy if exists "forget own memory" on public.memory_facts;
create policy "forget own memory" on public.memory_facts
  for delete using (auth.uid() = user_id);

-- Nearest facts to a message, by cosine distance, for one account.
create or replace function public.match_memory_facts(
  p_user_id uuid,
  p_embedding extensions.vector(768),
  p_count int default 12
)
returns table (fact text, distance float)
language sql stable
set search_path = public, extensions
as $$
  select f.fact, f.embedding <=> p_embedding as distance
  from public.memory_facts f
  where f.user_id = p_user_id and f.embedding is not null
  order by f.embedding <=> p_embedding
  limit greatest(1, least(p_count, 40));
$$;

-- Stores a fact unless it is the same fact said differently: an exact repeat
-- (case-insensitive) or one whose embedding is within 0.12 cosine distance of
-- something already known. Returns true only when something new was kept.
create or replace function public.remember_fact(
  p_user_id uuid,
  p_fact text,
  p_embedding extensions.vector(768),
  p_source text default 'app'
)
returns boolean
language plpgsql
set search_path = public, extensions
as $$
begin
  if p_embedding is not null and exists (
    select 1 from public.memory_facts
    where user_id = p_user_id and embedding is not null
      and embedding <=> p_embedding < 0.12
  ) then
    return false;
  end if;

  insert into public.memory_facts (user_id, fact, embedding, source)
  values (p_user_id, trim(p_fact), p_embedding, p_source)
  on conflict (user_id, lower(fact)) do nothing;
  return found;
end;
$$;

revoke all on function public.match_memory_facts(uuid, extensions.vector, int) from public, anon, authenticated;
revoke all on function public.remember_fact(uuid, text, extensions.vector, text) from public, anon, authenticated;

-- Which door a message came through, so the app can show that a turn was
-- sent from Telegram rather than typed here.
alter table public.chat_messages
  add column if not exists via text not null default 'app' check (via in ('app', 'telegram'));

-- One-time codes that link a Telegram chat to an account. The app makes one,
-- opens t.me/<bot>?start=<code>, and the webhook redeems it. Short-lived and
-- single-use, because whoever holds the code becomes the account's Telegram.
create table if not exists public.telegram_link_codes (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{16,64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

alter table public.telegram_link_codes enable row level security;

drop policy if exists "make own link code" on public.telegram_link_codes;
create policy "make own link code" on public.telegram_link_codes
  for insert with check (auth.uid() = user_id);

-- 0050: what Claude changed through the connector (Nov 2026).
--
-- The connector (functions/mcp) lets an AI app the account signed in to add
-- and change work, events and inbox thoughts. Approved as "saved right away,
-- easy to undo": the AI app's own allow prompt is the confirmation, so rule 6
-- is kept by making every change visible and reversible afterwards instead.
-- Each write lands here with what the row looked like before, and Settings >
-- Connected apps lists them with Undo.
--
-- Written by the connector with the account's own token, so RLS applies to it
-- exactly as to the app. Nothing here is deleted by Undo: the row is stamped,
-- so the list still says what was offered and taken back.

create table if not exists public.connector_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- The OAuth client that made the change, from the token's client_id claim.
  client_id text,
  tool text not null check (length(tool) between 1 and 60),
  target_table text not null check (target_table in ('assignments', 'events', 'inbox_items')),
  target_id uuid not null,
  -- Null for a row the connector created: undoing it removes the row.
  before jsonb,
  summary text not null check (length(trim(summary)) between 1 and 300),
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create index if not exists connector_changes_recent
  on public.connector_changes (user_id, created_at desc);

alter table public.connector_changes enable row level security;

drop policy if exists "read own connector changes" on public.connector_changes;
create policy "read own connector changes" on public.connector_changes
  for select using (auth.uid() = user_id);

drop policy if exists "record own connector changes" on public.connector_changes;
create policy "record own connector changes" on public.connector_changes
  for insert with check (auth.uid() = user_id);

drop policy if exists "undo own connector changes" on public.connector_changes;
create policy "undo own connector changes" on public.connector_changes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.connector_changes to authenticated;

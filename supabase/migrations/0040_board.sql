-- =============================================================================
-- 0040_board.sql — the widget board on Today, its goals, and its photos.
-- Oct 2026, built from the approved "Today Pegboard" prototype.
--
-- THE LAYOUT IS A SETTING, NOT A TABLE
--
-- The board is an ordered list of widgets, each with a type, a size and a
-- few options (a clock face, a countdown's date, a link). It is read whole
-- and written whole, it belongs to the account like the theme and Today's
-- section order (0036) do, and nothing ever queries one widget on its own.
-- So it is one jsonb column on app_settings rather than a table of rows that
-- would have to be reassembled in order on every open. Null means the
-- default board, so a new account and an account that reset it are the same
-- state.
--
-- A widget's options never hold another account's data: a goal widget names
-- a goal by id and the goal itself is a row under RLS; a photo widget names
-- a path inside the caller's own folder.
--
-- GOALS
--
-- A number to reach by a date: "Read Leviathan, 9 of 15 chapters, by
-- 6 Nov". Progress is a count the person moves, never a run of days, so it
-- can never become a streak (rule 3) — there is no "per day", nothing resets,
-- and a goal reached stays reached.
--
-- PHOTOS
--
-- A private bucket, one folder per account named by the account id, which
-- is the whole access rule: the first path segment must be auth.uid(). Shrunk
-- on the phone to 1200 px before upload and capped at 2 MB here, so a board
-- of six photos costs about a megabyte of the free tier's shared gigabyte.
-- Skipped where there is no storage schema (the PGlite test database).
-- =============================================================================

alter table public.app_settings
  add column if not exists board jsonb
    check (board is null or (jsonb_typeof(board) = 'array' and jsonb_array_length(board) <= 60));

-- app_settings is read through a column list (0034), so the new column must
-- be granted or the app cannot see it.
grant select (board) on public.app_settings to authenticated;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  -- What is counted: "chapters", "problems", "pages". Free text, optional.
  unit text not null default '' check (length(unit) <= 40),
  have integer not null default 0 check (have >= 0),
  target integer not null check (target between 1 and 100000),
  -- A day in the account's own zone, never an instant: "by 6 November".
  by_day date,
  created_at timestamptz not null default now(),
  constraint goals_progress check (have <= target)
);

create index if not exists goals_user on public.goals (user_id, created_at);

alter table public.goals enable row level security;

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('board-photos', 'board-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists "own board photos read" on storage.objects';
    execute 'drop policy if exists "own board photos write" on storage.objects';
    execute 'drop policy if exists "own board photos delete" on storage.objects';

    execute $p$
      create policy "own board photos read" on storage.objects
        for select to authenticated
        using (bucket_id = 'board-photos' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
    execute $p$
      create policy "own board photos write" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'board-photos' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
    execute $p$
      create policy "own board photos delete" on storage.objects
        for delete to authenticated
        using (bucket_id = 'board-photos' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  end if;
end;
$$;

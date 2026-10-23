-- =============================================================================
-- 0043_assignment_files.sql — the brief, kept with the work (22 Oct 2026).
--
-- 0025 chose a single link over file uploads, for good reasons: the free tier's
-- storage is one pool shared by every account, files need their own access
-- rules, and the copy on Moodle is the current one. Those costs are real, and
-- this migration accepts them on purpose, because a link cannot do two things
-- a file can: open when the page behind it needs a login the app does not
-- have, and be read by the AI guide.
--
-- The costs are bounded rather than ignored:
--
--   - PDF only, 10 MB a file (the bucket enforces both).
--   - Three files per piece of work and thirty per account (a trigger, so the
--     limit holds for every writer and not only for this client).
--   - Private bucket, one folder per account, same shape as board-photos.
--   - `link` stays. A file is an addition to it, never a replacement.
--
-- The guide is stored on the file's row because it is about that file: a new
-- version of the brief is a new file and gets its own guide.
--
-- Deleting a row cannot delete the object — Storage's files are not removed by
-- SQL — so the client removes the object first and the row second. An object
-- orphaned by a delete made offline costs a few megabytes and is reachable by
-- nobody else, because the folder is the owner's.
-- =============================================================================

create table if not exists public.assignment_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  -- The name the person gave it, shown in the list. Not the storage key.
  name text not null check (length(trim(name)) between 1 and 200),
  -- <user id>/<assignment id>/<random>.pdf inside the work-files bucket.
  path text not null unique check (length(path) <= 300),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  -- The saved AI guide, or null. Shape is validated by the function that
  -- produces it (supabase/functions/_shared/guide.ts); only its size is
  -- bounded here.
  guide jsonb check (guide is null or pg_column_size(guide) <= 40000),
  guide_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists assignment_files_work
  on public.assignment_files (assignment_id, created_at);
create index if not exists assignment_files_user
  on public.assignment_files (user_id);

alter table public.assignment_files enable row level security;

drop policy if exists "own assignment files" on public.assignment_files;
create policy "own assignment files" on public.assignment_files
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.assignments a
      where a.id = assignment_id and a.user_id = auth.uid()
    )
  );

create or replace function public.limit_assignment_files()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.assignment_files where assignment_id = new.assignment_id) >= 3 then
    raise exception 'A piece of work can hold three files.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.assignment_files where user_id = new.user_id) >= 30 then
    raise exception 'An account can hold thirty files.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists assignment_files_limit on public.assignment_files;
create trigger assignment_files_limit
  before insert on public.assignment_files
  for each row execute function public.limit_assignment_files();

-- The bucket and its rules, skipped where there is no storage schema (the
-- PGlite test database), exactly as 0040 does for board photos.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('work-files', 'work-files', false, 10485760, array['application/pdf'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists "own work files read" on storage.objects';
    execute 'drop policy if exists "own work files write" on storage.objects';
    execute 'drop policy if exists "own work files delete" on storage.objects';

    execute $p$
      create policy "own work files read" on storage.objects
        for select to authenticated
        using (bucket_id = 'work-files' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
    execute $p$
      create policy "own work files write" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'work-files' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
    execute $p$
      create policy "own work files delete" on storage.objects
        for delete to authenticated
        using (bucket_id = 'work-files' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  end if;
end;
$$;

comment on table public.assignment_files is
  'PDFs attached to a piece of work, with the AI guide saved against each. '
  'Capped at three per work and thirty per account; the object lives in the '
  'private work-files bucket under the owner''s folder.';

-- =============================================================================
-- 0046_file_integrity.sql — two holes in assignment_files (0043), from the audit.
--
-- 1. THE PATH WAS NOT CHECKED. The row policy proves the row is yours and the
--    work is yours, and says nothing about `path`. The guide function reads the
--    object at `path` with the service role, so a row that names another
--    account's object would have it read and summarised for you. Knowing that
--    path takes three random ids, which is why it was never exploited, but a
--    rule that holds only while ids stay secret is not a rule. The path must be
--    <user>/<work>/<name>.pdf, which is exactly what the client writes.
--
-- 2. THE LIMIT COULD BE RACED. The trigger counted then let the insert
--    through, so two uploads at once both saw two files and both went in. A
--    per-account advisory lock makes the count and the insert one step.
-- =============================================================================

alter table public.assignment_files
  drop constraint if exists assignment_files_path_owned;
alter table public.assignment_files
  add constraint assignment_files_path_owned
  check (path like user_id::text || '/' || assignment_id::text || '/%');

create or replace function public.limit_assignment_files()
returns trigger
language plpgsql
as $$
begin
  -- Held until the insert commits, so the next upload counts this one.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  if (select count(*) from public.assignment_files where assignment_id = new.assignment_id) >= 3 then
    raise exception 'A piece of work can hold three files.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.assignment_files where user_id = new.user_id) >= 30 then
    raise exception 'An account can hold thirty files.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

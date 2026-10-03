-- Exams and presentations count toward a course grade, Oct 2026.
--
-- A syllabus's midterm and final are usually the largest share of a course —
-- sixty or seventy percent between them — and they are imported as EVENTS, so
-- they get the night-before escalation. The importer wrote an event's weight
-- into its notes ("25% of the grade") because events had nowhere to keep it,
-- and the grade standing read only assignments. So the biggest pieces of
-- every course were missing from it.
--
-- Events now carry the same two numbers as assignments, with the same rules.

alter table public.events
  add column if not exists weight_percent numeric(5, 2),
  add column if not exists grade_percent numeric(5, 2);

alter table public.events
  drop constraint if exists events_weight_percent_range;
alter table public.events
  add constraint events_weight_percent_range
  check (weight_percent is null or (weight_percent > 0 and weight_percent <= 100));

alter table public.events
  drop constraint if exists events_grade_percent_range;
alter table public.events
  add constraint events_grade_percent_range
  check (grade_percent is null or (grade_percent >= 0 and grade_percent <= 100));

create index if not exists events_weighted_idx
  on public.events (user_id, course_id)
  where weight_percent is not null;

-- Exams imported before this kept their weight only as machine-written text in
-- the notes. Read it back, and clear exactly that text so it is not said twice.
update public.events
   set weight_percent = (regexp_match(notes, '^(\d+(?:\.\d+)?)% of the grade$'))[1]::numeric,
       notes = null
 where weight_percent is null
   and notes ~ '^\d+(\.\d+)?% of the grade$'
   and (regexp_match(notes, '^(\d+(?:\.\d+)?)% of the grade$'))[1]::numeric > 0
   and (regexp_match(notes, '^(\d+(?:\.\d+)?)% of the grade$'))[1]::numeric <= 100;

comment on column public.events.weight_percent is
  'Share of the final course grade, 0-100, for an exam or presentation.';
comment on column public.events.grade_percent is
  'What it scored, 0-100. Entered by hand, never inferred.';

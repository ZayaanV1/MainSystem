-- =============================================================================
-- 0022_assessment_weight.sql — what a piece of work is worth, and what it got.
--
-- The syllabus importer has always extracted `weight_percent`. It validates it
-- (rejects anything outside 0-100, rounds to one decimal), shows it on the
-- confirmation screen as a chip — and then flattens it into a free-text note:
--
--     notes: `${item.weight_percent}% of the grade`
--
-- So the app was paying a model to read "the midterm is worth 30%", proving it
-- was a number, and then storing it as prose. It could not sort by it, total
-- it, or answer the question every student actually has, which is not "what is
-- soonest" but "what matters".
--
-- TWO COLUMNS, NOT ONE
--
-- `weight_percent` is what the work is worth. `grade_percent` is what it
-- scored. They are genuinely different facts with different lifecycles — the
-- weight is known when the syllabus is read, the grade arrives weeks after the
-- work is done — and collapsing them would make "worth 30%" and "got 30%"
-- indistinguishable, which is the worst possible ambiguity in this data.
--
-- WHY THIS IS NOT GAMIFICATION
--
-- The scope list forbids "gamification, points, levels, badges" and rule 3
-- forbids anything that keeps score across days. This is neither. A grade is a
-- fact the institution already holds and the student already knows; recording
-- it is bookkeeping, not scoring. The line this must not cross is inventing a
-- number the university did not give — no computed GPA projections, no "you
-- are on track for a B+", nothing that grades the person rather than storing
-- what a marker wrote. What it enables is subtraction: how much of this course
-- is still unmarked.
--
-- NUMERIC, NOT REAL
--
-- Same rule the macros follow. A weight of 12.5 accumulated in floating point
-- across a term's worth of assessments drifts, and a course that totals to
-- 99.97% looks like a data-entry error when it is an arithmetic one.
-- =============================================================================

alter table public.assignments
  add column if not exists weight_percent numeric(5, 2),
  add column if not exists grade_percent numeric(5, 2);

-- The importer already enforces these; the database enforces them too, because
-- the importer is not the only writer any more — the editor and the chatbot
-- both reach this table.
alter table public.assignments
  drop constraint if exists assignments_weight_percent_range;
alter table public.assignments
  add constraint assignments_weight_percent_range
  check (weight_percent is null or (weight_percent > 0 and weight_percent <= 100));

alter table public.assignments
  drop constraint if exists assignments_grade_percent_range;
alter table public.assignments
  add constraint assignments_grade_percent_range
  check (grade_percent is null or (grade_percent >= 0 and grade_percent <= 100));

-- Only rows that carry a weight, which is the minority — a partial index keeps
-- it small and keeps the common "everything for this course" query unaffected.
create index if not exists assignments_weighted_idx
  on public.assignments (user_id, course_id)
  where weight_percent is not null;

comment on column public.assignments.weight_percent is
  'Share of the final course grade, 0-100. Extracted by the syllabus importer, '
  'previously discarded into the notes field.';

comment on column public.assignments.grade_percent is
  'What this assessment actually scored, 0-100. Entered by hand — never '
  'inferred, never projected.';

-- =============================================================================
-- 0005_course_uniqueness.sql — stop duplicate courses existing at all.
--
-- Nothing prevented two courses with the same code. A double-tapped "Add
-- course" produced two CHEM 233s, and from then on every filter chip, every
-- course dot and every syllabus match silently referred to whichever one was
-- found first. It showed up as six identical chips in the week view.
--
-- Case-insensitive, because "chem 233" and "CHEM 233" are the same course and
-- being told otherwise by your own planner is absurd.
--
-- Archived courses are excluded from the constraint: taking the same course
-- again in a later term is legitimate, and the old one should not block it.
-- =============================================================================

-- Collapse any duplicates already stored, keeping the oldest and repointing
-- everything that referenced the others at it.
with ranked as (
  select id, user_id, lower(coalesce(nullif(trim(code), ''), trim(name))) as key,
         row_number() over (
           partition by user_id, lower(coalesce(nullif(trim(code), ''), trim(name)))
           order by created_at
         ) as n
    from public.courses
   where not archived
),
keepers as (
  select user_id, key, id from ranked where n = 1
),
dupes as (
  select r.id as dupe_id, k.id as keep_id
    from ranked r
    join keepers k on k.user_id = r.user_id and k.key = r.key
   where r.n > 1
)
update public.assignments a
   set course_id = d.keep_id
  from dupes d
 where a.course_id = d.dupe_id;

with ranked as (
  select id, user_id, lower(coalesce(nullif(trim(code), ''), trim(name))) as key,
         row_number() over (
           partition by user_id, lower(coalesce(nullif(trim(code), ''), trim(name)))
           order by created_at
         ) as n
    from public.courses
   where not archived
),
keepers as (
  select user_id, key, id from ranked where n = 1
),
dupes as (
  select r.id as dupe_id, k.id as keep_id
    from ranked r
    join keepers k on k.user_id = r.user_id and k.key = r.key
   where r.n > 1
)
update public.events e
   set course_id = d.keep_id
  from dupes d
 where e.course_id = d.dupe_id;

delete from public.courses c
 using (
   select id, row_number() over (
            partition by user_id, lower(coalesce(nullif(trim(code), ''), trim(name)))
            order by created_at
          ) as n
     from public.courses
    where not archived
 ) r
 where c.id = r.id and r.n > 1;

-- One index per identity a course can be recognised by. Code is optional, so
-- it gets its own partial index rather than being folded into a coalesce that
-- would let a code-less course collide with a differently-named one.
create unique index courses_unique_code
  on public.courses (user_id, lower(trim(code)))
  where not archived and code is not null and trim(code) <> '';

create unique index courses_unique_name
  on public.courses (user_id, lower(trim(name)))
  where not archived;

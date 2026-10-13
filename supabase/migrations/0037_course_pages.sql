-- A page per course, and what Abood knows about each one.
--
-- The course page is assembled from what the app already holds (the work,
-- the exams, the weights and marks) and this table keeps only the parts a
-- person writes themselves: notes, office hours, contacts, links, and the
-- syllabus text as it was read. Never a blank page to build first; the page
-- exists before a row does, and a row appears the first time something is
-- written on it.
--
-- Not notes in general (out of scope): one page per course, a few fields.

create table if not exists public.course_pages (
  course_id uuid primary key references public.courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notes text not null default '' check (length(notes) <= 20000),
  office_hours text not null default '' check (length(office_hours) <= 2000),
  contacts text not null default '' check (length(contacts) <= 2000),
  -- [{ "label": "Moodle", "url": "https://…" }, …]
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 30),
  syllabus_text text check (syllabus_text is null or length(syllabus_text) <= 60000),
  updated_at timestamptz not null default now()
);

create index if not exists course_pages_user on public.course_pages (user_id);

alter table public.course_pages enable row level security;

-- One's own pages, and only for one's own courses: a row naming someone
-- else's course id is refused even though the id is unguessable.
drop policy if exists "own course pages" on public.course_pages;
create policy "own course pages" on public.course_pages
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid())
  );

-- A fact Abood learned that is about one course ("The TA for ELEC 364 is
-- Priya") is filed on that course's page. Set by the server when the fact
-- names the course's code or name; a course removed leaves the fact, unfiled.
alter table public.memory_facts
  add column if not exists course_id uuid references public.courses(id) on delete set null;

create index if not exists memory_facts_course on public.memory_facts (user_id, course_id) where course_id is not null;

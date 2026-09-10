-- =============================================================================
-- 0025_assignment_link.sql — where the thing actually is.
--
-- Every assignment has somewhere it lives: the Moodle page, the submission
-- form, the brief as a PDF, the shared doc. Until now that went in `notes`
-- alongside prose, which means it is not clickable, cannot be distinguished
-- from a sentence that happens to contain a URL, and is retyped from memory
-- every time it is needed.
--
-- ONE LINK, NOT ATTACHMENTS.
--
-- The obvious feature here is file uploads, and it is the wrong one. Files
-- mean Supabase Storage, a bucket with its own access rules, quota on a free
-- tier shared by every account, a virus-scanning question, and an orphan
-- problem when an assignment is deleted. All of that to store a copy of a PDF
-- the university is already hosting and will keep hosting.
--
-- A link is the whole of the value at none of the cost. It is also more
-- honest: the brief on Moodle is the current version, and a copy uploaded in
-- September is whatever it was in September.
--
-- WHY THE SCHEME IS CONSTRAINED HERE
--
-- The column refuses anything that is not http or https. A stored
-- `javascript:` URL rendered into an anchor is a script that runs when a
-- person clicks their own assignment, and the app is the thing that put it on
-- screen. The client validates too, but the client is not the only writer —
-- the chatbot proposes assignments, and the syllabus importer creates them.
-- A constraint is the one place a rule cannot be forgotten by a new caller.
-- =============================================================================

alter table public.assignments
  add column if not exists link text;

alter table public.assignments
  drop constraint if exists assignments_link_scheme;
alter table public.assignments
  add constraint assignments_link_scheme
  check (
    link is null
    or (length(link) <= 2000 and link ~* '^https?://[^[:space:]]+$')
  );

comment on column public.assignments.link is
  'Where the work lives — a submission page, a brief, a shared doc. http(s) '
  'only, enforced here because the client is not the only writer: the chatbot '
  'and the syllabus importer both create assignments.';

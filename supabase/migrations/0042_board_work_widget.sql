-- 0042: every saved board gets an Assignments widget (19 Oct 2026).
--
-- Today's work list moved to Schedule, and Today became the widget board.
-- Finishing work is the one action that has to stay free (rule 3's sibling
-- in CLAUDE.md), so it must never need a trip to another tab: the
-- Assignments widget, with a tick on each row, is what keeps it on Today.
-- The default board (a null column) already has one; a board someone saved
-- before this change may not.
--
-- Adds one medium Assignments widget as the third item of any saved board
-- with none. Removes nothing and reorders nothing else, and it can be taken
-- off again from Edit widgets. jsonb_insert past the end of a short array
-- appends, so a board of one or two widgets gets it last.

update public.app_settings
set board = jsonb_insert(
  board,
  '{2}',
  jsonb_build_object('id', 'w0042work', 'type', 'work', 'size', 'm', 'opts', '{}'::jsonb)
)
where board is not null
  and jsonb_typeof(board) = 'array'
  and not exists (
    select 1 from jsonb_array_elements(board) as w where w ->> 'type' = 'work'
  );

-- A reply that is not an answer.
--
-- When a question could not be answered — the model withdrawn, the budget
-- spent, the network down — the reason was saved as an ordinary assistant
-- message, so a transcript read as though Abood had SAID "Could not reach the
-- model" in the same voice as a real answer. The reason is kept (a question
-- sitting there with no reply reads as the app having ignored it) but it is
-- marked, so it can be drawn as a note about the conversation rather than a
-- turn in it.

alter table public.chat_messages
  add column if not exists failed boolean not null default false;

-- Earlier failures, recognised by the only thing they have: the fixed
-- sentences the app used to explain them. Every one of these was written by
-- the app, never by a model, so matching them cannot mislabel an answer.
update public.chat_messages
set failed = true
where role = 'assistant'
  and failed = false
  and (
    content like 'Out of model requests%'
    or content like 'No model is configured%'
    or content like 'The model returned something unreadable%'
    or content like 'The model declined to read%'
    or content like 'Could not reach the model%'
    or content like 'The configured model is no longer available%'
    or content like 'The model behind this has been withdrawn%'
    or content like 'That is all the AI help for today%'
    or content like 'Couldn''t reach the server%'
    or content like 'The server returned something unreadable%'
    or content like 'That is unavailable right now%'
    or content like 'You are signed out%'
  );

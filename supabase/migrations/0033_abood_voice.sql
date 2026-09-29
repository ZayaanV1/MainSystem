-- How Abood talks, chosen per account.
--
-- 'plain' is the default voice every new account gets. 'bro' is a close
-- friend's register — slang, "bro", hype and teasing — modelled on the
-- previous companion bot its first user liked talking to. It is opt-in and
-- per account because it is one person's taste, and a stranger signing up
-- should not be called bro by default.
alter table public.app_settings
  add column if not exists abood_voice text not null default 'plain'
    check (abood_voice in ('plain', 'bro'));

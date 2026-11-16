-- Whether Abood may remember sensitive things (Nov 2026).
--
-- Memory was meant never to hold health, money or other people's private
-- lives, and an audit on 15 Nov found that it did. The owner's decision: make
-- it a switch, as Claude's own memory is. Off unless chosen, so a new account
-- never has that kept about it without asking. Off, Abood still listens and
-- answers; `learn` drops the fact before it is stored.

alter table public.app_settings
  add column if not exists abood_sensitive boolean not null default false;

grant select (abood_sensitive) on public.app_settings to authenticated;

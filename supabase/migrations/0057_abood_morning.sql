-- Abood's morning text (Nov 2026).
--
-- At an hour the account picks, Abood texts a short rundown of the day by
-- iMessage or Telegram. Off unless chosen: a stranger's account must never
-- start receiving texts it did not ask for. The hourly check-in tick sends it,
-- so it arrives at about :17 past the chosen hour.

alter table public.app_settings
  add column if not exists abood_morning_hour smallint
    check (abood_morning_hour is null or abood_morning_hour between 0 and 23),
  -- The local day it was last sent, so a retried tick never sends it twice.
  add column if not exists abood_morning_sent_on date;

grant select (abood_morning_hour, abood_morning_sent_on) on public.app_settings to authenticated;

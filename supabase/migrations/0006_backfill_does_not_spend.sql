-- =============================================================================
-- 0006_backfill_does_not_spend.sql
--
-- Ticking a PAST day must not change how many doses are left today.
--
-- The counter is a physical count of what is in the bottle, set by hand when a
-- prescription is collected. A pill taken on 29 July is already absent from
-- that count. Recording it after the fact is bookkeeping about the past, not a
-- new withdrawal — but the trigger deducted for it all the same, so
-- back-filling a rough week would quietly destroy the number.
--
-- The rule, stated once: today's tick spends a dose; any other day records
-- that it happened. Undo stays exactly symmetric because doses_applied is 0
-- for those rows, so returning it returns nothing.
--
-- This matters more than it looks. The dose count is the one number in this
-- app whose being wrong has consequences outside the app, and back-filling is
-- meant to be the friction-free act that makes a bad week recoverable. Those
-- two must not be in conflict.
-- =============================================================================

create or replace function public.take_doses()
returns trigger
language plpgsql
as $$
declare
  v_tracks boolean;
  v_per smallint;
  v_have integer;
  v_applied smallint;
begin
  -- A completion recorded for an earlier day never spends stock.
  if coalesce(new.backfilled, false) then
    new.doses_applied := 0;
    return new;
  end if;

  select tracks_doses, doses_per_completion, coalesce(doses_remaining, 0)
    into v_tracks, v_per, v_have
    from public.checklist_items
   where id = new.item_id
     for update;

  if not coalesce(v_tracks, false) then
    new.doses_applied := 0;
    return new;
  end if;

  -- Cap at what is actually there, so the deduction and its reversal agree.
  v_applied := least(v_per, v_have);

  update public.checklist_items
     set doses_remaining = v_have - v_applied
   where id = new.item_id;

  new.doses_applied := v_applied;
  return new;
end;
$$;

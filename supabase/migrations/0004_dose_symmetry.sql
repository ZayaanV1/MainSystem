-- =============================================================================
-- 0004_dose_symmetry.sql — make undo return exactly what check-off took.
--
-- The 0003 trigger deducted `doses_per_completion` floored at zero, but gave
-- back the full `doses_per_completion` on delete. Those two are not inverses,
-- and the gap invents medication that does not exist:
--
--   0 left, tap the row      -> greatest(0, 0 - 1) = 0   (nothing deducted)
--   untap it                 -> 0 + 1 = 1                (a pill from nowhere)
--
-- That is not a rounding quibble. Undo is a tap in the same place, so it
-- happens by accident constantly, and this is the one number in the app whose
-- being wrong has consequences outside the app — it is the difference between
-- noticing a refill is due and running out on a Sunday.
--
-- The fix is to stop recomputing the delta at delete time and instead record
-- what was actually taken, on the row that took it.
-- =============================================================================

alter table public.checklist_completions
  add column doses_applied smallint not null default 0;

comment on column public.checklist_completions.doses_applied is
  'Doses actually deducted by this completion. Reversed exactly on delete, so '
  'undo can never create or destroy medication. Zero for items that do not '
  'track doses, and for rows written before this column existed.';

-- -----------------------------------------------------------------------------
-- Deduction. BEFORE INSERT, so the amount taken can be written onto the row
-- that is being created.
-- -----------------------------------------------------------------------------
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
  select tracks_doses, doses_per_completion, coalesce(doses_remaining, 0)
    into v_tracks, v_per, v_have
    from public.checklist_items
   where id = new.item_id
     for update;

  if not coalesce(v_tracks, false) then
    new.doses_applied := 0;
    return new;
  end if;

  -- Cap at what is actually there. Taking more than exists is what made the
  -- deduction and the restoration disagree.
  v_applied := least(v_per, v_have);

  update public.checklist_items
     set doses_remaining = v_have - v_applied
   where id = new.item_id;

  new.doses_applied := v_applied;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Restoration. Returns precisely what that completion took, and nothing else.
-- -----------------------------------------------------------------------------
create or replace function public.return_doses()
returns trigger
language plpgsql
as $$
begin
  if coalesce(old.doses_applied, 0) = 0 then
    return old;
  end if;

  update public.checklist_items
     set doses_remaining = coalesce(doses_remaining, 0) + old.doses_applied
   where id = old.item_id
     and tracks_doses;

  return old;
end;
$$;

drop trigger if exists checklist_completion_doses on public.checklist_completions;
drop function if exists public.apply_dose_delta();

create trigger checklist_completion_take
  before insert on public.checklist_completions
  for each row execute function public.take_doses();

create trigger checklist_completion_return
  after delete on public.checklist_completions
  for each row execute function public.return_doses();

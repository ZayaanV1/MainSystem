-- =============================================================================
-- 0045_atomic_ai_budget.sql — a daily limit that holds when requests overlap.
--
-- THE BUG
--
-- A model call read the day's count, made the call, then added one. Fifty
-- requests sent together each read "0 used", all passed, and all were counted
-- afterwards: the cap limited how many calls a patient person could make, not
-- how many a script could. The shared free key was the thing being protected.
--
-- THE FIX
--
-- reserve_ai_use takes the slot and checks the limit in ONE statement, so two
-- requests cannot both be handed the last slot. release_ai_use gives a slot
-- back when the call never produced anything (the model was unreachable, the
-- reply was unusable), which keeps the old promise that hitting a wall does not
-- cost you a question.
--
-- A second, account-wide ceiling sits beside the per-account one. Limits are
-- per account, so many accounts on one free key add up; the ceiling is the
-- sum for the day across everyone using the shared key, and it is the one
-- guard against a flood of sign-ups spending the pool before real people can.
-- Accounts on their own key are never counted, so they never reach it.
--
-- Returns the count after reserving, -1 when this account is over its limit,
-- and -2 when the shared ceiling is reached.
-- =============================================================================

create or replace function public.reserve_ai_use(
  p_user_id uuid,
  p_local_day text,
  p_kind text,
  p_limit integer,
  p_global_limit integer default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  if p_limit <= 0 then
    return -1;
  end if;

  if p_global_limit is not null
     and (select coalesce(sum(count), 0) from public.ai_usage
          where local_day = p_local_day and kind = p_kind) >= p_global_limit then
    return -2;
  end if;

  insert into public.ai_usage (user_id, local_day, kind, count)
  values (p_user_id, p_local_day, p_kind, 1)
  on conflict (user_id, local_day, kind)
  do update set count = ai_usage.count + 1, updated_at = now()
  where ai_usage.count < p_limit
  returning count into new_count;

  -- The conflict branch's WHERE rejected the update: already at the limit.
  if new_count is null then
    return -1;
  end if;

  return new_count;
end;
$$;

create or replace function public.release_ai_use(
  p_user_id uuid,
  p_local_day text,
  p_kind text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_usage
  set count = greatest(count - 1, 0), updated_at = now()
  where user_id = p_user_id and local_day = p_local_day and kind = p_kind;
$$;

-- The sum above is read for every reservation; keep it an index scan.
create index if not exists ai_usage_day_kind on public.ai_usage (local_day, kind);

-- Service role only, exactly like record_ai_use (0034): a client that could
-- release its own slots could edit its way around the reserve.
revoke all on function public.reserve_ai_use(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.release_ai_use(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_ai_use(uuid, text, text, integer, integer) to service_role;
grant execute on function public.release_ai_use(uuid, text, text) to service_role;

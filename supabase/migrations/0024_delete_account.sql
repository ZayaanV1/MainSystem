-- =============================================================================
-- 0024_delete_account.sql — leaving.
--
-- The app can already export everything as JSON or CSV. It could not delete
-- anything. For a product with more than one user that is not a missing
-- feature so much as a missing promise: an app holding a term of coursework,
-- a food diary and a body-weight history should be leavable without emailing
-- anyone, and "you can leave whenever you want" is already the copy sitting
-- above the export buttons.
--
-- WHY A FUNCTION AND NOT AN EDGE FUNCTION
--
-- Every one of the twenty-one foreign keys to auth.users already cascades on
-- delete, so removing the auth row removes the account's data by construction
-- rather than by a delete script that could fall out of date the next time a
-- table is added. What the browser cannot do is delete an auth row — that
-- needs the service role. A security definer function is the smaller surface:
-- no new endpoint, no service-role key in reach of a request handler, and the
-- cascade stays the single source of truth about what belongs to an account.
--
-- THE ONLY THING THAT MAKES THIS SAFE
--
-- It takes NO ARGUMENTS. The id deleted is auth.uid() and nothing else, so
-- there is no parameter to tamper with and no code path that deletes anybody
-- but the caller. A version taking p_user_id would look almost identical and
-- would be a remote account-deletion endpoint for every authenticated user in
-- the system.
--
-- search_path is pinned for the usual security definer reason: without it a
-- caller controlling their own search_path could shadow `auth.users` with a
-- table of their own and change what this statement means.
-- =============================================================================

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller uuid := auth.uid();
begin
  -- An unauthenticated caller has no account to delete. Raising rather than
  -- returning quietly, because a silent success here would be indistinguishable
  -- from a deletion that worked.
  if caller is null then
    raise exception 'not authenticated';
  end if;

  -- Everything else follows from the cascades. If a future table forgets its
  -- `on delete cascade`, that table is the bug — not this function.
  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Deletes the CALLING account and, by cascade, all of its data. Takes no '
  'arguments on purpose: the id is auth.uid(), so it can never delete anyone '
  'other than the caller.';

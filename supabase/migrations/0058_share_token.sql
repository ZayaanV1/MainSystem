-- Share to the planner from an iPhone (Nov 2026).
--
-- An Apple Shortcut in the share sheet posts text to the `share` function with
-- a per-account key. Only the key's SHA-256 is stored, so a leak of this table
-- cannot be replayed; the key itself is shown once, when it is issued.

alter table public.app_settings
  add column if not exists share_token_hash text unique;

-- The hash of 32 random bytes says nothing; readable so the app can tell
-- whether a key is set (every app_settings column but the AI keys is).
grant select (share_token_hash) on public.app_settings to authenticated;

create or replace function public.issue_share_token()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  token text;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;
  -- url-safe base64 of 32 random bytes; issuing again replaces the old key.
  token := replace(replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  update public.app_settings
     set share_token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
   where user_id = caller;
  return token;
end;
$$;

revoke all on function public.issue_share_token() from public, anon;
grant execute on function public.issue_share_token() to authenticated;

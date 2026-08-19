-- =============================================================================
-- 0014_calendar_feed.sql — a subscribable calendar feed.
--
-- The feed has to be readable without a login, because a calendar app cannot
-- present one. So the URL itself is the credential, and the design follows
-- from that:
--
--   The token is 32 random bytes, not a uuid. A uuid is 122 bits with
--   structure and is meant to be unique, not unguessable.
--
--   It is stored separately from every other setting so it can be rotated
--   without touching anything else, and rotating it is the revoke button:
--   whoever has the old link stops seeing new deadlines.
--
--   Nothing but titles and times ever goes in the feed. Notes are excluded on
--   purpose — a URL that can leak should carry as little as possible.
-- =============================================================================

alter table public.app_settings
  add column if not exists ics_token text unique;

-- -----------------------------------------------------------------------------
-- Issues a feed token, or returns the existing one.
--
-- SECURITY DEFINER so generating it does not require a general update path on
-- app_settings, and so the token can be produced server-side rather than by a
-- client whose randomness is harder to reason about.
-- -----------------------------------------------------------------------------
create or replace function public.ensure_ics_token(p_user_id uuid, p_rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text;
begin
  select ics_token into token from public.app_settings where user_id = p_user_id;

  if token is null or p_rotate then
    -- url-safe base64 of 32 random bytes.
    token := replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_');
    token := replace(token, '=', '');

    insert into public.app_settings (user_id, ics_token)
    values (p_user_id, token)
    on conflict (user_id) do update set ics_token = excluded.ics_token;
  end if;

  return token;
end;
$$;

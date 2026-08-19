-- =============================================================================
-- 0019_own_api_key.sql — let an account bring its own Gemini key.
--
-- One shared key funding every user's parsing and chat does not survive more
-- than a handful of accounts: the free tier is a single pool, and one heavy
-- user exhausts food logging for everybody. A per-account key removes that
-- coupling entirely — your usage is yours, and so is the bill.
--
-- Stored here rather than in the browser because the value has to reach the
-- edge function that calls Gemini, and a key in localStorage would still make
-- that trip while also being readable by any script on the page.
--
-- RLS already restricts app_settings to auth.uid() = user_id, so no other
-- account can read it. The service role can, which is what lets the function
-- use it on the owner's behalf and nothing else.
-- =============================================================================

alter table public.app_settings
  add column if not exists gemini_api_key text;

comment on column public.app_settings.gemini_api_key is
  'The account''s own Gemini key, or null to use the shared one. Never returned to any other user: RLS restricts this table to its owner.';

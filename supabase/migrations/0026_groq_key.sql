-- =============================================================================
-- 0026_groq_key.sql — a second provider key, per account.
--
-- Same shape and same reasoning as `gemini_api_key` in 0019: an account that
-- supplies its own key stops competing for a shared free tier, so the daily
-- budget does not apply to it.
--
-- WHY A SECOND COLUMN RATHER THAN ONE "api_key"
--
-- They are not interchangeable. Groq's chat models are text-only, so the diet
-- parser — which sends photographs of food and of nutrition labels — cannot
-- run on it. A single key column would imply a single provider and quietly
-- break photo logging the moment someone pasted a Groq key.
--
-- Two columns keeps the split honest: chat can move to Groq while vision stays
-- on Gemini, and the app can tell which paths a given account has covered.
--
-- Write-only, like the Gemini key. The app asks WHETHER a key is set and never
-- reads one back — a secret that can be re-displayed is a secret with one more
-- way out than it needs.
-- =============================================================================

alter table public.app_settings
  add column if not exists groq_api_key text;

comment on column public.app_settings.groq_api_key is
  'Optional per-account Groq key for the chatbot. Write-only: the app checks '
  'whether it is set and never returns it. Food parsing stays on Gemini '
  'because Groq chat models do not accept images.';

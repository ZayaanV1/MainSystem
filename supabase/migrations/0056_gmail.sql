-- =============================================================================
-- 0056_gmail.sql — read-only Gmail for Abood.
--
-- One row per account that connected Gmail. The refresh token is a key to the
-- whole inbox, so RLS is on with NO policies: only the service role (the gmail
-- function and Abood) reads it. The app asks the gmail function whether a link
-- exists and never sees the token. Deleting the account deletes the row.
-- =============================================================================

create table if not exists public.gmail_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  refresh_token text not null,
  created_at timestamptz not null default now()
);

alter table public.gmail_links enable row level security;
revoke all on public.gmail_links from anon, authenticated;

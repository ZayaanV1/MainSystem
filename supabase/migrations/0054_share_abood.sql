-- One Abood across Claude and texting (10 Nov 2026).
--
-- The connector (functions/mcp) deliberately kept Abood's memory and
-- conversation out of reach of other AI apps. This switch lets an account
-- choose otherwise, off by default, so the original reasoning stands for
-- everyone who has not asked. With it on, a connected app can read what Abood
-- remembers and the recent conversation (both already readable under RLS),
-- add a memory, and send the account a text as Abood.

alter table public.app_settings
  add column if not exists share_abood boolean not null default false;
grant select (share_abood) on public.app_settings to authenticated;

alter table public.memory_facts drop constraint if exists memory_facts_source_check;
alter table public.memory_facts
  add constraint memory_facts_source_check check (source in ('app', 'telegram', 'imessage', 'claude'));

create or replace function private.share_abood_on()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce((select share_abood from public.app_settings where user_id = auth.uid()), false);
$$;

-- A fact from a connected app. Stored without an embedding: the connector has
-- no model key, and recall already picks up unembedded facts by recency.
create or replace function public.connector_remember(p_fact text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not private.share_abood_on() then
    raise exception 'Sharing Abood with connected apps is off';
  end if;
  insert into public.memory_facts (user_id, fact, source)
  values (auth.uid(), trim(p_fact), 'claude')
  on conflict (user_id, lower(fact)) do nothing;
  return found;
end;
$$;

-- A text to the account itself, as Abood. Recorded in the conversation so
-- Abood knows he said it; queued for the Mac bridge when the door is iMessage.
-- Telegram is sent by the function, which holds the bot token.
create or replace function public.connector_text_me(p_texts text[], p_via text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text;
begin
  if auth.uid() is null or not private.share_abood_on() then
    raise exception 'Sharing Abood with connected apps is off';
  end if;
  if p_via not in ('imessage', 'telegram') or coalesce(array_length(p_texts, 1), 0) not between 1 and 4 then
    raise exception 'Bad text';
  end if;
  if p_via = 'imessage' then
    select handle into v_handle from public.imessage_links where user_id = auth.uid() order by created_at limit 1;
    if v_handle is null then raise exception 'No iMessage link'; end if;
    insert into public.imessage_outbox (user_id, handle, body)
    select auth.uid(), v_handle, left(t, 2000) from unnest(p_texts) t where length(trim(t)) > 0;
  end if;
  insert into public.chat_messages (user_id, role, content, via)
  values (auth.uid(), 'assistant', array_to_string(p_texts, E'\n\n'), p_via);
end;
$$;

revoke all on function private.share_abood_on() from public, anon, authenticated;
revoke all on function public.connector_remember(text) from public, anon;
revoke all on function public.connector_text_me(text[], text) from public, anon;
grant execute on function public.connector_remember(text) to authenticated;
grant execute on function public.connector_text_me(text[], text) to authenticated;

import { supabase } from './supabase';

/**
 * Abood outside the chat screen: the Telegram link and the memory.
 *
 * Both are settings about the conversation rather than parts of it, so they
 * live here rather than in chat.ts.
 */

const FUNCTIONS = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export interface MemoryFact {
  id: string;
  fact: string;
  source: 'app' | 'telegram';
  created_at: string;
}

/** What Abood remembers, oldest first — the order it was learned in. */
export async function loadMemory(): Promise<{ facts: MemoryFact[]; failed: boolean }> {
  const { data, error } = await supabase
    .from('memory_facts')
    .select('id, fact, source, created_at')
    .order('created_at', { ascending: true });
  return { facts: (data ?? []) as MemoryFact[], failed: Boolean(error) };
}

export async function forgetFact(id: string): Promise<boolean> {
  const { error } = await supabase.from('memory_facts').delete().eq('id', id);
  return !error;
}

/** Whether this account has a Telegram chat linked. */
export async function telegramLinked(): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('notification_channels')
    .select('id')
    .eq('kind', 'telegram')
    .limit(1);
  if (error) return null;
  return (data ?? []).length > 0;
}

/**
 * A one-time link to the bot that connects this account's Telegram.
 *
 * The code is random and short-lived, and the bot's username is asked of the
 * server rather than written into the app, so a deployment on a different bot
 * needs no code change.
 */
export async function telegramLink(userId: string): Promise<{ url: string } | { error: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const code = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const [{ error }, who] = await Promise.all([
    supabase.from('telegram_link_codes').insert({ user_id: userId, code }),
    fetch(`${FUNCTIONS}/telegram`)
      .then((r) => r.json() as Promise<{ username?: string }>)
      .catch(() => ({}) as { username?: string }),
  ]);

  if (error) return { error: 'Could not make a link. Try again.' };
  if (!who.username) return { error: 'The Telegram bot is not reachable right now. Try again shortly.' };
  return { url: `https://t.me/${who.username}?start=${code}` };
}

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

export interface BridgeStatus {
  /** Whether this account has a bridge at all (a key has been issued). */
  exists: boolean;
  /** The Apple ID people text, once the Mac has reported it. */
  address: string | null;
  /** Checked in within the last ten minutes (it reports every five). */
  online: boolean;
  lastSeen: string | null;
  /** Numbers and Apple IDs linked to this account. */
  handles: string[];
}

export async function bridgeStatus(): Promise<BridgeStatus | null> {
  const [bridge, links] = await Promise.all([
    // This account's own bridge. Another account's is invisible to it.
    supabase.from('imessage_bridges').select('address, last_seen').maybeSingle(),
    supabase.from('imessage_links').select('handle').order('created_at'),
  ]);
  if (bridge.error || links.error) return null;
  const lastSeen = (bridge.data?.last_seen as string | null) ?? null;
  return {
    exists: Boolean(bridge.data),
    address: (bridge.data?.address as string | null) ?? null,
    lastSeen,
    online: lastSeen !== null && Date.now() - Date.parse(lastSeen) < 10 * 60_000,
    handles: ((links.data ?? []) as { handle: string }[]).map((l) => l.handle),
  };
}

/**
 * A new key for this account's bridge, shown once.
 *
 * Only its hash is stored, so it cannot be shown again; making a new one
 * disconnects whichever Mac held the old one.
 */
export async function issueBridgeKey(): Promise<{ key: string } | { error: string }> {
  const { data, error } = await supabase.rpc('issue_bridge_token');
  if (error || typeof data !== 'string') return { error: 'Could not make a bridge key. Try again.' };
  return { key: data };
}

export async function unlinkHandle(handle: string): Promise<boolean> {
  const { error } = await supabase.from('imessage_links').delete().eq('handle', handle);
  return !error;
}

/**
 * A Messages link that texts the one-time code to the bridge. On an iPhone
 * it opens Messages with the text already written; sending it links the
 * number it is sent from.
 */
export async function imessageLink(userId: string, address: string): Promise<{ url: string } | { error: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const code = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const { error } = await supabase.from('telegram_link_codes').insert({ user_id: userId, code });
  if (error) return { error: 'Could not make a link. Try again.' };
  return { url: `sms:${address}&body=${encodeURIComponent(`link ${code}`)}` };
}

export interface CheckinSettings {
  on: boolean;
  /** Null: when I have gone quiet. A number: every that many hours. */
  every: number | null;
  from: number;
  until: number;
}

export async function loadCheckins(): Promise<CheckinSettings | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('abood_checkins, abood_checkin_every_hours, abood_checkin_from, abood_checkin_until')
    .maybeSingle();
  if (error || !data) return null;
  return {
    on: Boolean(data.abood_checkins),
    every: (data.abood_checkin_every_hours as number | null) ?? null,
    from: Number(data.abood_checkin_from ?? 10),
    until: Number(data.abood_checkin_until ?? 21),
  };
}

export async function saveCheckins(userId: string, s: CheckinSettings): Promise<boolean> {
  const { error } = await supabase
    .from('app_settings')
    .update({
      abood_checkins: s.on,
      abood_checkin_every_hours: s.every,
      abood_checkin_from: s.from,
      abood_checkin_until: s.until,
    })
    .eq('user_id', userId);
  return !error;
}

/**
 * imessage — Abood by iMessage, through a Mac.
 *
 * Apple has no iMessage API. A small program on a Mac signed into Messages
 * (bridge/imessage) watches for new messages, posts each one here, and sends
 * back whatever this returns. Everything after "which account is this?" is
 * the shared door, so iMessage and Telegram cannot behave differently.
 *
 * TRUST, AND WHOSE BRIDGE IT IS
 *
 * A bridge belongs to one account. Settings issues it a key, shown once; the
 * bridge sends that key with every request and this function finds the
 * account from its hash. Everything after that is scoped to the account: only
 * its own link codes are redeemed, only handles linked to it are answered,
 * and only its own queued texts are collected.
 *
 * This used to be one shared secret and one global bridge row that every
 * signed-in account could read, so any new account saw the owner's Apple ID
 * address and could link a phone to the owner's Mac (Oct 2026 audit, H4).
 *
 * The bridge installed before that still sends the old shared secret. It is
 * accepted once, for the single account that already has linked phones and no
 * bridge of its own yet, and that account's bridge row is created from it —
 * so the running Mac keeps working and moves itself onto the new scheme.
 * Re-running the installer with a key from Settings replaces it.
 *
 * SILENCE BY DEFAULT
 *
 * A handle that is not linked to the bridge's account gets no reply at all,
 * unless it is trying to link. The bridge answers on whatever Apple ID the Mac
 * is signed into, and if that were ever a personal one, a friend texting it
 * must never be answered by a bot.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { HELP, converse } from '../_shared/door.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';
/** A queued check-in older than this is expired rather than delivered. */
const CHECKIN_FRESH_MS = 6 * 60 * 60 * 1000;

/** The shared secret from before bridges belonged to accounts. See above. */
const LEGACY_SECRET = env('IMESSAGE_BRIDGE_SECRET');

// deno-lint-ignore no-explicit-any
type Admin = any;

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Phone numbers arrive as +15145550100, Apple IDs as lower-case emails. */
export function normaliseHandle(handle: string): string {
  const h = handle.trim();
  if (h.includes('@')) return h.toLowerCase();
  const digits = h.replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/** Which account this bridge belongs to, or null. */
async function bridgeOwner(admin: Admin, presented: string): Promise<string | null> {
  if (!presented) return null;
  const hash = await sha256hex(presented);

  const { data: bridge } = await admin
    .from('imessage_bridges')
    .select('user_id')
    .eq('token_hash', hash)
    .maybeSingle();
  if (bridge?.user_id) return bridge.user_id as string;

  // The pre-October bridge. Only for one unambiguous account that has no
  // bridge yet: once an account has a row, a newer key from Settings must
  // never be overwritten by the old Mac checking in.
  if (!LEGACY_SECRET || !sameSecret(presented, LEGACY_SECRET)) return null;

  const { data: links } = await admin.from('imessage_links').select('user_id');
  const owners = [...new Set(((links ?? []) as { user_id: string }[]).map((l) => l.user_id))];
  if (owners.length !== 1) return null;

  const { data: existing } = await admin
    .from('imessage_bridges')
    .select('user_id')
    .eq('user_id', owners[0])
    .maybeSingle();
  if (existing) return null;

  await admin.from('imessage_bridges').insert({ user_id: owners[0], token_hash: hash });
  return owners[0];
}

async function heartbeat(admin: Admin, ownerId: string, address?: string) {
  await admin
    .from('imessage_bridges')
    .update({ last_seen: new Date().toISOString(), ...(address ? { address } : {}) })
    .eq('user_id', ownerId);
}

async function link(admin: Admin, ownerId: string, handle: string, code: string): Promise<boolean> {
  // Only the bridge owner's own codes. A code made by another account is left
  // alone rather than consumed, so it still works on that account's bridge.
  const { data: row } = await admin
    .from('telegram_link_codes')
    .delete()
    .eq('code', code)
    .eq('user_id', ownerId)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle();
  if (!row?.user_id) return false;
  await admin.from('imessage_links').upsert({ handle, user_id: ownerId });
  return true;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const ownerId = await bridgeOwner(admin, req.headers.get('x-bridge-secret') ?? '');
  if (!ownerId) return new Response('unauthorised', { status: 401 });

  let body: { kind?: string; address?: string; handle?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const reply = (replies: string[]) =>
    new Response(JSON.stringify({ replies }), { headers: { 'content-type': 'application/json' } });

  // The bridge says hello on start and every few minutes, so Settings can say
  // whether the Mac is actually up.
  if (body.kind === 'hello') {
    await heartbeat(admin, ownerId, body.address?.trim().slice(0, 200));
    return reply([]);
  }

  /*
   * Texts Abood starts (check-ins) are queued by the scheduler and collected
   * here, because only the Mac can send an iMessage. Delete-and-return, so a
   * text is handed to the bridge exactly once — and only this account's.
   */
  if (body.kind === 'outbox') {
    await heartbeat(admin, ownerId);

    // A check-in is about the moment it was written. One that waited days
    // for a Mac that was off — sixteen did, through early October, while a
    // bridge without the outbox poll ran — would arrive as a burst of stale
    // "how did this morning go?" texts. Older than CHECKIN_FRESH_MS, it
    // expires unsent; the record of it stays in the transcript.
    await admin
      .from('imessage_outbox')
      .delete()
      .eq('user_id', ownerId)
      .lt('created_at', new Date(Date.now() - CHECKIN_FRESH_MS).toISOString());

    const { data } = await admin
      .from('imessage_outbox')
      .delete()
      .eq('user_id', ownerId)
      .lt('created_at', new Date(Date.now() + 1000).toISOString())
      .select('handle, body, created_at');
    const queued = ((data ?? []) as { handle: string; body: string; created_at: string }[]).sort((x, y) =>
      x.created_at.localeCompare(y.created_at),
    );
    return new Response(JSON.stringify({ outbox: queued.map((q) => ({ handle: q.handle, text: q.body })) }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (body.kind !== 'message' || !body.handle) return reply([]);
  await heartbeat(admin, ownerId);

  const handle = normaliseHandle(body.handle);
  const text = (body.text ?? '').trim();

  const linkAttempt = /^link\s+([A-Za-z0-9_-]{16,64})$/i.exec(text);
  if (linkAttempt) {
    const ok = await link(admin, ownerId, handle, linkAttempt[1]);
    return reply([
      ok
        ? `Connected. This conversation is now your planner.\n\n${HELP}`
        : 'That link has expired or was already used. Open Settings in the planner and make a new one.',
    ]);
  }

  const { data: linked } = await admin
    .from('imessage_links')
    .select('user_id')
    .eq('handle', handle)
    .eq('user_id', ownerId)
    .maybeSingle();
  if (!linked?.user_id) return reply([]);

  if (!text) return reply(['I can only read text for now.']);

  const replies: string[] = [];
  try {
    await converse({
      admin,
      userId: ownerId,
      text,
      via: 'imessage',
      send: async (t) => {
        replies.push(t);
      },
    });
  } catch (e) {
    console.error('[imessage]', e);
    replies.push('I could not answer that just now. Try again in a minute.');
  }
  return reply(replies);
});

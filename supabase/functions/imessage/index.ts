/**
 * imessage — Abood by iMessage, through a Mac.
 *
 * Apple has no iMessage API. A small program on a Mac signed into Messages
 * (bridge/imessage) watches for new messages, posts each one here, and sends
 * back whatever this returns. Everything after "which account is this?" is
 * the shared door, so iMessage and Telegram cannot behave differently.
 *
 * TRUST
 *
 * Only the bridge may call this: every request carries a secret the bridge
 * was configured with, compared in constant time. A handle — a phone number
 * or Apple ID — joins an account only by texting a one-time code that account
 * made in Settings.
 *
 * SILENCE BY DEFAULT
 *
 * A handle that is not linked gets no reply at all, unless it is trying to
 * link. The bridge answers on whatever Apple ID the Mac is signed into, and
 * if that were ever a personal one, a friend texting it must never be
 * answered by a bot. Replying to strangers "you are not connected" would be
 * exactly that.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { HELP, converse } from '../_shared/door.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';
const SECRET = env('IMESSAGE_BRIDGE_SECRET');

// deno-lint-ignore no-explicit-any
type Admin = any;

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Phone numbers arrive as +15145550100, Apple IDs as lower-case emails. */
export function normaliseHandle(handle: string): string {
  const h = handle.trim();
  if (h.includes('@')) return h.toLowerCase();
  const digits = h.replace(/[^\d+]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

async function heartbeat(admin: Admin, address?: string) {
  await admin
    .from('imessage_bridge')
    .upsert({ id: 1, last_seen: new Date().toISOString(), ...(address ? { address } : {}) });
}

async function link(admin: Admin, handle: string, code: string): Promise<boolean> {
  const { data: row } = await admin
    .from('telegram_link_codes')
    .delete()
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle();
  const userId = row?.user_id as string | undefined;
  if (!userId) return false;
  await admin.from('imessage_links').upsert({ handle, user_id: userId });
  return true;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!sameSecret(req.headers.get('x-bridge-secret') ?? '', SECRET)) {
    return new Response('unauthorised', { status: 401 });
  }

  let body: { kind?: string; address?: string; handle?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const reply = (replies: string[]) =>
    new Response(JSON.stringify({ replies }), { headers: { 'content-type': 'application/json' } });

  // The bridge checks in on start and every few minutes, so Settings can say
  // whether the Mac is actually there.
  if (body.kind === 'hello') {
    await heartbeat(admin, body.address?.trim().slice(0, 200));
    return reply([]);
  }

  /*
   * Messages Abood started (check-ins). Handed over and removed in one step,
   * so each is sent at most once: a check-in lost to a crash is better than
   * the same check-in sent twice.
   */
  if (body.kind === 'outbox') {
    await heartbeat(admin);
    const { data } = await admin
      .from('imessage_outbox')
      .delete()
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
  await heartbeat(admin);

  const handle = normaliseHandle(body.handle);
  const text = (body.text ?? '').trim();

  const linkAttempt = /^link\s+([A-Za-z0-9_-]{16,64})$/i.exec(text);
  if (linkAttempt) {
    const ok = await link(admin, handle, linkAttempt[1]);
    return reply([
      ok
        ? `we're connected. this is me now.\n\n${HELP}`
        : 'That link has expired or was already used. Open Settings in the planner and make a new one.',
    ]);
  }

  const { data: linked } = await admin
    .from('imessage_links')
    .select('user_id')
    .eq('handle', handle)
    .maybeSingle();
  const userId = linked?.user_id as string | undefined;
  if (!userId) return reply([]);

  if (!text) return reply(["i can only read text for now — tell me in words?"]);

  const replies: string[] = [];
  try {
    await converse({
      admin,
      userId,
      text,
      via: 'imessage',
      send: async (t) => {
        replies.push(t);
      },
    });
  } catch (e) {
    console.error('[imessage]', e);
    replies.push("that didn't go through on my end. send it again in a minute?");
  }
  return reply(replies);
});

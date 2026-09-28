/**
 * telegram — Abood, by text message.
 *
 * The bot already existed to deliver the morning digest; this makes it a
 * conversation. Telegram calls this webhook for every message sent to the
 * bot. The chat is matched to an account through the Telegram channel the
 * digest already uses, the message goes through the same askAbood as the
 * app's chat screen (same planner data, same transcript, same memory, same
 * daily budget), and the answer is sent back.
 *
 * TRUST
 *
 * This is served without a login, because Telegram cannot present one. Two
 * things stand in for it. Every request must carry the secret token Telegram
 * was given at setWebhook time, compared in constant time; without it the
 * endpoint answers 401 and does nothing. And a chat is only ever connected to
 * an account by redeeming a one-time code that account made moments before —
 * a chat id alone, which anyone can find for their own chat, never links
 * anything.
 *
 * NEVER SILENTLY WRITE
 *
 * A change Abood proposes over Telegram is saved to the transcript as a
 * proposal and confirmed in the app, exactly as in the app. Telegram gets the
 * words and a link; the database gets nothing until the button is pressed.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { HELP, converse } from '../_shared/door.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';

const BOT = env('TELEGRAM_BOT_TOKEN');
const SECRET = env('TELEGRAM_WEBHOOK_SECRET');
/** Telegram's own ceiling on one message. */
const MAX_TELEGRAM = 4_000;

// deno-lint-ignore no-explicit-any
type Admin = any;

interface Update {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
    from?: { first_name?: string };
  };
}

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function tg(method: string, body: Record<string, unknown>): Promise<Response | null> {
  try {
    return await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

// Plain text, no parse_mode: course titles are full of underscores and
// brackets that Telegram's Markdown modes reject, and a reply that fails to
// send over punctuation is worse than an unstyled one.
const say = (chatId: number, text: string) =>
  tg('sendMessage', { chat_id: chatId, text: text.slice(0, MAX_TELEGRAM), disable_web_page_preview: true });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/** The bot's public username, for the app's Connect link. Cached per isolate. */
let botName: string | null = null;
async function username(): Promise<string | null> {
  if (botName) return botName;
  const res = await tg('getMe', {});
  if (!res?.ok) return null;
  const body = (await res.json()) as { result?: { username?: string } };
  botName = body.result?.username ?? null;
  return botName;
}

async function accountFor(admin: Admin, chatId: number): Promise<string | null> {
  const { data } = await admin
    .from('notification_channels')
    .select('user_id')
    .eq('kind', 'telegram')
    .eq('config->>chat_id', String(chatId))
    .limit(1);
  return (data?.[0]?.user_id as string | undefined) ?? null;
}

/** Redeems a link code: this chat becomes that account's Telegram. */
async function link(admin: Admin, chatId: number, code: string): Promise<string | null> {
  const { data: row } = await admin
    .from('telegram_link_codes')
    .delete()
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle();
  const userId = row?.user_id as string | undefined;
  if (!userId) return null;

  const { data: existing } = await admin
    .from('notification_channels')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', 'telegram')
    .limit(1);

  if (existing?.[0]) {
    await admin
      .from('notification_channels')
      .update({ config: { chat_id: String(chatId) }, enabled: true, failed_at: null, failure_reason: null })
      .eq('id', existing[0].id);
  } else {
    // Behind Web Push, as setup.mjs does: Telegram is the conversation and
    // the fallback, not the first choice for a digest.
    await admin
      .from('notification_channels')
      .insert({ user_id: userId, kind: 'telegram', config: { chat_id: String(chatId) }, priority: 20 });
  }
  return userId;
}


async function handle(admin: Admin, update: Update): Promise<void> {
  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return;
  const chatId = msg.chat.id;
  const text = (msg.text ?? '').trim();

  // ---- linking -------------------------------------------------------------
  const start = /^\/start(?:\s+([A-Za-z0-9_-]{16,64}))?$/.exec(text);
  if (start) {
    if (start[1]) {
      const linked = await link(admin, chatId, start[1]);
      await say(
        chatId,
        linked
          ? `Connected. This chat is now your planner.\n\n${HELP}`
          : 'That link has expired or was already used. Open Settings in the planner and tap Connect Telegram again.',
      );
      return;
    }
    const known = await accountFor(admin, chatId);
    await say(chatId, known ? HELP : 'To talk to your planner here, open Settings in the app and tap Connect Telegram.');
    return;
  }

  const userId = await accountFor(admin, chatId);
  if (!userId) {
    await say(chatId, 'This chat is not connected to a planner yet. Open Settings in the app and tap Connect Telegram.');
    return;
  }

  if (!text) {
    await say(chatId, 'I can only read text for now.');
    return;
  }

  await converse({
    admin,
    userId,
    text,
    via: 'telegram',
    send: (t) => say(chatId, t),
    typing: () => tg('sendChatAction', { chat_id: chatId, action: 'typing' }),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // Public: the bot's username, so the app can build its Connect link
  // without anyone hardcoding which bot this deployment uses.
  if (req.method === 'GET') {
    const name = await username();
    return new Response(JSON.stringify({ username: name }), {
      status: name ? 200 : 503,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  }

  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  if (!sameSecret(req.headers.get('x-telegram-bot-api-secret-token') ?? '', SECRET)) {
    return new Response('unauthorised', { status: 401 });
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return new Response('ok');
  }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  // Always 200: a non-2xx makes Telegram redeliver the same update, and a
  // failure here is not one that retrying the whole message would fix.
  try {
    await handle(admin, update);
  } catch (e) {
    console.error('[telegram]', e);
  }
  return new Response('ok');
});

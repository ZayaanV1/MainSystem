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

import { askAbood, learn } from '../_shared/abood.ts';
import { geminiProvider } from '../_shared/llm/gemini.ts';
import { groqProvider } from '../_shared/llm/groq.ts';
import { withFallback } from '../_shared/llm/chain.ts';
import { checkBudget, recordUse } from '../_shared/budget.ts';
import { localDayKey } from '../_shared/time.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';

const BOT = env('TELEGRAM_BOT_TOKEN');
const SECRET = env('TELEGRAM_WEBHOOK_SECRET');
const APP_URL = env('APP_URL');

const MAX_MESSAGE = 2_000;
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

const HELP = [
  'Ask me anything about your work, classes, checklist or food, and I answer from what is in your planner.',
  '',
  '/memory  what I remember about you',
  '/forget  clear what I remember',
  '/help  this message',
].join('\n');

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

  // ---- commands ----------------------------------------------------------
  if (/^\/help\b/.test(text)) {
    await say(chatId, HELP);
    return;
  }

  if (/^\/memory\b/.test(text)) {
    const { data } = await admin
      .from('memory_facts')
      .select('fact')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    const facts = ((data ?? []) as { fact: string }[]).map((r) => `- ${r.fact}`);
    await say(
      chatId,
      facts.length
        ? `What I remember:\n${facts.join('\n')}\n\nYou can remove any of these in Settings, or send /forget.`
        : 'Nothing yet. I pick things up as we talk — routines, preferences, what helps.',
    );
    return;
  }

  if (/^\/forget\b/.test(text)) {
    // Two steps, because it cannot be undone.
    if (!/^\/forget\s+yes$/i.test(text)) {
      await say(chatId, 'That clears everything I remember about you. Send "/forget yes" to go ahead.');
      return;
    }
    const { count } = await admin
      .from('memory_facts')
      .delete({ count: 'exact' })
      .eq('user_id', userId);
    await say(chatId, count ? `Cleared ${count} ${count === 1 ? 'thing' : 'things'}.` : 'There was nothing to clear.');
    return;
  }

  // ---- a question --------------------------------------------------------
  const message = text.slice(0, MAX_MESSAGE);

  const { data: settings } = await admin
    .from('app_settings')
    .select('gemini_api_key, groq_api_key, timezone')
    .eq('user_id', userId)
    .maybeSingle();

  const rawGemini = (settings?.gemini_api_key as string | null)?.trim() || null;
  const ownGemini = rawGemini && !rawGemini.startsWith('gsk_') ? rawGemini : null;
  const rawGroq = (settings?.groq_api_key as string | null)?.trim() || null;
  const ownGroq = rawGroq && !rawGroq.startsWith('AIza') ? rawGroq : null;
  const tz = ((settings?.timezone as string | null) ?? 'UTC').trim() || 'UTC';
  const today = localDayKey(new Date(), tz);

  const geminiKey = ownGemini ?? env('GEMINI_API_KEY');
  const gemini = geminiProvider(geminiKey);
  const groqKey = ownGroq ?? env('GROQ_API_KEY');
  const provider = groqKey ? withFallback(groqProvider(groqKey, env('GROQ_MODEL') || undefined), gemini) : gemini;
  const onOwnKey = Boolean(ownGroq || (!groqKey && ownGemini));

  // The same daily budget as the app's chat, so a second door is not a way
  // round the reserve kept for logging food.
  const budget = await checkBudget(admin, userId, 'chat', today, onOwnKey);

  await admin.from('chat_messages').insert({ user_id: userId, role: 'user', content: message, via: 'telegram' });

  if (!budget.allowed) {
    const reason = 'That is enough questions for today — the rest of the daily model budget is kept for logging food. It resets tomorrow.';
    await admin
      .from('chat_messages')
      .insert({ user_id: userId, role: 'assistant', content: reason, failed: true, via: 'telegram' });
    await say(chatId, reason);
    return;
  }

  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });

  const result = await askAbood({ admin, userId, message, today, tz, provider, geminiKey });
  await recordUse(admin, userId, 'chat', today, onOwnKey);

  if (!result.ok) {
    const reason =
      result.failure === 'quota'
        ? 'Out of model requests for now. Try again later.'
        : 'I could not answer that just now. Try again in a minute.';
    await admin
      .from('chat_messages')
      .insert({ user_id: userId, role: 'assistant', content: `${reason} ${result.message}`.slice(0, 1_000), failed: true, via: 'telegram' });
    await say(chatId, reason);
    return;
  }

  const content = result.warnings.length ? `${result.reply}\n\n${result.warnings.join(' ')}` : result.reply;
  await admin.from('chat_messages').insert({
    user_id: userId,
    role: 'assistant',
    content,
    proposed_action: result.action,
    referenced_ids: result.referenced,
    via: 'telegram',
  });

  await say(
    chatId,
    result.action
      ? `${content}\n\nNothing is changed until you confirm it in the planner${APP_URL ? `: ${APP_URL}` : '.'}`
      : content,
  );

  // Learned after answering, and said out loud: memory that grows in secret
  // is memory nobody can correct.
  const learned = await learn(admin, userId, message, provider, geminiKey, 'telegram').catch(() => []);
  if (learned.length) {
    await say(chatId, `Noted: ${learned.join(' ')}`);
  }
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

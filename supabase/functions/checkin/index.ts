/**
 * checkin — Abood texts first.
 *
 * Hourly, from pg_cron. For each account that talks to Abood by text and has
 * gone quiet, Abood sends one check-in the way a friend would: about
 * something real (what they said last, what is coming up, what Abood
 * remembers), never "you haven't talked to me". Then it waits. A second
 * check-in is never sent into a silence the first one has not broken.
 *
 * WHEN
 *   - quiet for QUIET_HOURS since their last message,
 *   - between 11:00 and 20:00 in their own zone,
 *   - they have talked to Abood before (it never cold-starts),
 *   - check-ins are on (Settings), and a text channel is linked.
 *
 * THE MORNING TEXT
 *   Separately, and only when turned on: once a day at the chosen hour, the
 *   run-down of the day (see _shared/morning.ts). It ignores the window and
 *   the unanswered rule above — a morning run-down is useful either way.
 *
 * COST
 *   One small model call per check-in — at most one per quiet stretch, so
 *   about one a day for someone who talks daily, against dozens of chat
 *   calls. It is counted against the same daily chat budget.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { gatherContext, recall } from '../_shared/abood.ts';
import { isVoice, voiceNote } from '../_shared/chat.ts';
import { textsOf } from '../_shared/door.ts';
import { geminiProvider } from '../_shared/llm/gemini.ts';
import { groqProvider } from '../_shared/llm/groq.ts';
import { withFallback } from '../_shared/llm/chain.ts';
import { checkBudget, recordUse } from '../_shared/budget.ts';
import { endOfDayUTC, localDayKey, localHourMinute, startOfDayUTC } from '../_shared/time.ts';
import { fallbackMorning, morningSchedule, strayTimes } from '../_shared/morning.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';
const CRON_SECRET = env('CRON_SECRET');
const BOT = env('TELEGRAM_BOT_TOKEN');

/** "When I've gone quiet" means this long without a message. */
const QUIET_HOURS = Number(env('ABOOD_QUIET_HOURS') || '20');
/**
 * On a set rhythm, check-ins that go unanswered stop after this many in a
 * row: a friend who keeps texting into silence is not a friend, and it would
 * spend the budget on nobody.
 */
const MAX_UNANSWERED = 2;

// deno-lint-ignore no-explicit-any
type Admin = any;

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const CHECKIN_SCHEMA = {
  type: 'object',
  properties: { texts: { type: 'array', items: { type: 'string' } } },
  required: ['texts'],
} as const;

const CHECKIN_INSTRUCTION = [
  'You are Abood: a close friend who also keeps this student\'s planner, and who',
  'texts like a person — lowercase, casual, short, no emoji, no markdown. They',
  'have not messaged you for a bit (see how long below), and you are texting',
  'first. If this is a regular check-in they asked for, keep it light.',
  'Write one to three short texts (each a sentence or two) that check in the',
  'way a good friend would: about THEM, not their to-do list. Pick up what',
  'they last talked about — especially anything personal they shared — or',
  'something from WHAT YOU REMEMBER, and ask how it is going. Be warm and',
  'specific. You are a companion, not a manager: do not open with work.',
  'Vary what a check-in IS, the way a friend\'s texts vary: sometimes a',
  'follow-up on something that was left hanging ("so did the talk with your',
  'dad happen"), sometimes a thought you had about what they said last time,',
  'sometimes something tied to the hour or the day (a friday evening, a late',
  'night), sometimes just a small warm line with no question at all. Look at',
  'your own last texts below and do not send the same kind of check-in twice',
  'in a row. Never an empty check-in — "just checking in", "how are you" or',
  '"thinking of you" with nothing after it: always attach the specific thing',
  '("yo, checking in. how\'s the leg recovery coming along?").',
  'Never guilt them: no "you haven\'t talked to me", no "where have you been",',
  'no counting days, no streaks. Mention the planner only if something is due',
  'today or tomorrow and there is nothing more personal to pick up, and then',
  'lightly, in passing. Never invent a fact about their',
  'planner; only use what is shown. Refer to items by name, never by labels',
  'like [w2]. Return only the JSON.',
].join(' ');

const MORNING_SCHEMA = CHECKIN_SCHEMA;

const MORNING_INSTRUCTION = [
  'You are Abood, a close friend who keeps this student\'s planner, writing',
  'their morning text — the first thing they see from you today. Same shape',
  'every morning, on purpose: it is meant to feel familiar. Word it freshly.',
  'Exactly three short texts, lowercase, no emoji, no markdown:',
  '(1) good morning plus how they slept ("morning, hope you got some solid',
  'rest last night" territory). If something from the last conversation or',
  'what you remember is still going on — an injury, a rough head day,',
  'missing someone, an exam just done — fold it in here in a few words',
  '("hope your head\'s feeling a bit clearer today").',
  '(2) today\'s run-down, in one flowing sentence, in order, every item under',
  'TODAY and nothing else: "saw travel at 10:00, then COEN 212 at 11:45, MATH',
  '205 at 1:15, study at 3:00, gym at 5:00, and assignment 2 due at 11:59pm".',
  'Use the times exactly as written there. Never add an end time or a time',
  'that is not listed. A room can ride along ("over at FB S150"). With',
  'nothing listed, say the day is open ("sunday looks super open").',
  '(3) a send-off that matches DAY SHAPE: packed or busy — "lowk a full',
  'campus run, just take it block by block"; light — "just take it one step',
  'at a time"; clear — "take today easy and recharge"; ending with an offer',
  'like "lmk if you need anything".',
  'Never mention anything unlogged, missed or undone. Refer to things by',
  'name, never by labels like [w2]. Return only the JSON.',
].join(' ');

async function tgSend(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  }).catch(() => null);
}

/** Where to reach them: iMessage when the Mac is up, else Telegram. */
async function channelFor(admin: Admin, userId: string) {
  const [{ data: link }, { data: bridge }, { data: tg }] = await Promise.all([
    admin.from('imessage_links').select('handle').eq('user_id', userId).order('created_at').limit(1),
    admin.from('imessage_bridge').select('last_seen').maybeSingle(),
    admin.from('notification_channels').select('config').eq('user_id', userId).eq('kind', 'telegram').eq('enabled', true).limit(1),
  ]);
  const bridgeUp = bridge?.last_seen && Date.now() - Date.parse(bridge.last_seen) < 10 * 60_000;
  if (link?.[0]?.handle && bridgeUp) return { via: 'imessage' as const, handle: link[0].handle as string };
  const chatId = tg?.[0]?.config?.chat_id as string | undefined;
  if (chatId && BOT) return { via: 'telegram' as const, chatId };
  return null;
}

function providerFor(settings: Record<string, unknown>) {
  const rawGemini = (settings.gemini_api_key as string | null)?.trim() || null;
  const ownGemini = rawGemini && !rawGemini.startsWith('gsk_') ? rawGemini : null;
  const rawGroq = (settings.groq_api_key as string | null)?.trim() || null;
  const ownGroq = rawGroq && !rawGroq.startsWith('AIza') ? rawGroq : null;
  const geminiKey = ownGemini ?? env('GEMINI_API_KEY');
  const gemini = geminiProvider(geminiKey);
  const groqKey = ownGroq ?? env('GROQ_API_KEY');
  const provider = groqKey ? withFallback(groqProvider(groqKey, env('GROQ_MODEL') || undefined), gemini) : gemini;
  const onOwnKey = Boolean(ownGroq || (!groqKey && ownGemini));
  return { provider, geminiKey, onOwnKey };
}

type Channel = NonNullable<Awaited<ReturnType<typeof channelFor>>>;

/** Records what Abood said first and hands it to the channel. */
async function deliver(admin: Admin, userId: string, channel: Channel, texts: string[]) {
  await admin.from('chat_messages').insert({
    user_id: userId,
    role: 'assistant',
    content: texts.join('\n\n'),
    via: channel.via,
    checkin: true,
  });
  if (channel.via === 'imessage') {
    await admin.from('imessage_outbox').insert(texts.map((body) => ({ handle: channel.handle, body })));
  } else {
    for (const [i, t] of textsOf(texts.join('\n\n')).entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 900));
      await tgSend(channel.chatId, t);
    }
  }
}

/** Hours after the chosen one in which a missed tick still sends it. */
const MORNING_CATCHUP_HOURS = 3;

/**
 * The morning text, if it is due. Null when it is not, so the ordinary
 * check-in can run; a string (what happened) when this tick was the morning.
 */
async function morning(admin: Admin, userId: string, settings: Record<string, unknown>, tz: string, hour: number): Promise<string | null> {
  if (!settings.abood_morning) return null;
  const at = Number(settings.abood_morning_hour ?? 9);
  if (hour < at || hour >= at + MORNING_CATCHUP_HOURS) return null;
  const today = localDayKey(new Date(), tz);
  if (settings.abood_morning_sent_on === today) return null;

  const channel = await channelFor(admin, userId);
  if (!channel) return 'morning: no text channel';

  // Claimed before anything is written, so two overlapping ticks send one.
  const { data: claimed } = await admin
    .from('app_settings')
    .update({ abood_morning_sent_on: today })
    .eq('user_id', userId)
    .or(`abood_morning_sent_on.is.null,abood_morning_sent_on.neq.${today}`)
    .select('user_id');
  if (!claimed?.length) return 'morning: already sent';

  const from = startOfDayUTC(today, tz).toISOString();
  const until = endOfDayUTC(today, tz).toISOString();
  const [{ data: events }, { data: work }, { data: turns }] = await Promise.all([
    admin
      .from('events')
      .select('title, starts_at, all_day')
      .eq('user_id', userId)
      .gte('starts_at', from)
      .lte('starts_at', until)
      .order('starts_at'),
    admin
      .from('assignments')
      .select('title, due_at, due_has_time, courses(code)')
      .eq('user_id', userId)
      .neq('status', 'done')
      .gte('due_at', from)
      .lte('due_at', until),
    admin
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', userId)
      .eq('failed', false)
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  const day = morningSchedule(
    // deno-lint-ignore no-explicit-any
    ((events ?? []) as any[]).map((e) => ({ title: e.title, starts_at: e.starts_at, all_day: Boolean(e.all_day) })),
    // deno-lint-ignore no-explicit-any
    ((work ?? []) as any[]).map((w) => ({
      title: w.title,
      due_at: w.due_at,
      due_has_time: Boolean(w.due_has_time),
      course: w.courses?.code ?? null,
    })),
    tz,
  );
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const voice = isVoice(settings.abood_voice) ? settings.abood_voice : null;
  const fallback = fallbackMorning(day, weekday, voice === 'bro');

  const { provider, geminiKey, onOwnKey } = providerFor(settings);
  const budget = await checkBudget(admin, userId, 'chat', today, onOwnKey);
  if (!budget.allowed) {
    await deliver(admin, userId, channel, fallback);
    return 'morning: sent plain (over budget)';
  }

  const memory = await recall(admin, userId, 'how they are doing, what is going on in their life', geminiKey).catch(() => []);
  const history = ((turns ?? []) as { role: string; content: string }[])
    .reverse()
    .map((t) => `${t.role === 'user' ? 'They said' : 'You said'}: ${t.content.slice(0, 300)}`)
    .join('\n');

  const result = await provider.complete<unknown>({
    instruction: MORNING_INSTRUCTION,
    input: [
      voiceNote(voice),
      `It is ${weekday} morning.`,
      `TODAY\n${day.lines.length ? day.lines.map((l) => `- ${l}`).join('\n') : '(nothing on the calendar)'}`,
      `DAY SHAPE: ${day.shape}`,
      '',
      memory.length ? `WHAT YOU REMEMBER\n${memory.map((f) => `- ${f}`).join('\n')}\n` : '',
      history ? `YOUR LAST CONVERSATION\n${history}` : '',
    ].join('\n'),
    schema: MORNING_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.7,
    reasoning: 'low',
    maxOutputTokens: 600,
    timeoutMs: 30_000,
  });
  await recordUse(admin, userId, 'chat', today, onOwnKey);

  const raw = result.ok ? (result.value as { texts?: unknown })?.texts : null;
  const texts = (Array.isArray(raw) ? raw : [])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 3);
  // Nothing written, or a time the calendar did not give: the plain version
  // goes instead, because a wrong time in the morning run-down is worse than
  // a less charming one.
  const stray = strayTimes(texts, day.times);
  if (!texts.length || stray.length) {
    await deliver(admin, userId, channel, fallback);
    return `morning: sent plain (${!texts.length ? 'nothing written' : `stray ${stray.join(', ')}`})`;
  }
  await deliver(admin, userId, channel, texts);
  return `morning: sent via ${channel.via}`;
}

async function checkIn(admin: Admin, userId: string, settings: Record<string, unknown>): Promise<string> {
  const tz = ((settings.timezone as string | null) ?? 'UTC').trim() || 'UTC';
  const { hour } = localHourMinute(new Date(), tz);
  const morningResult = await morning(admin, userId, settings, tz, hour);
  if (morningResult) return morningResult;
  if (!settings.abood_checkins) return 'check-ins off';
  const from = Number(settings.abood_checkin_from ?? 10);
  const until = Number(settings.abood_checkin_until ?? 21);
  if (hour < from || hour >= until) return 'outside hours';
  const every = settings.abood_checkin_every_hours as number | null;

  const { data: lastUser } = await admin
    .from('chat_messages')
    .select('created_at, content')
    .eq('user_id', userId)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(1);
  const last = lastUser?.[0];
  if (!last) return 'never talked';

  const { data: since } = await admin
    .from('chat_messages')
    .select('created_at')
    .eq('user_id', userId)
    .eq('checkin', true)
    .gt('created_at', last.created_at)
    .order('created_at', { ascending: false });
  const unanswered = (since ?? []) as { created_at: string }[];

  if (every) {
    // A rhythm they chose: every N hours since anything was said either way.
    const { data: latest } = await admin
      .from('chat_messages')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);
    const lastAny = latest?.[0]?.created_at ?? last.created_at;
    if (Date.now() - Date.parse(lastAny) < every * 3_600_000 - 5 * 60_000) return 'not yet';
    if (unanswered.length >= MAX_UNANSWERED) return 'waiting for a reply';
  } else {
    if (Date.now() - Date.parse(last.created_at) < QUIET_HOURS * 3_600_000) return 'not quiet';
    if (unanswered.length) return 'already checked in';
  }

  const channel = await channelFor(admin, userId);
  if (!channel) return 'no text channel';

  const { provider, geminiKey, onOwnKey } = providerFor(settings);

  const today = localDayKey(new Date(), tz);
  const budget = await checkBudget(admin, userId, 'chat', today, onOwnKey);
  if (!budget.allowed) return 'over budget';

  const [context, memory, { data: turns }] = await Promise.all([
    gatherContext(admin, userId, today, tz, { scopes: new Set(), shortIds: true }),
    recall(admin, userId, last.content, geminiKey),
    admin
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', userId)
      .eq('failed', false)
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  const history = ((turns ?? []) as { role: string; content: string }[])
    .reverse()
    .map((t) => `${t.role === 'user' ? 'They said' : 'You said'}: ${t.content.slice(0, 300)}`)
    .join('\n');
  const hours = Math.round((Date.now() - Date.parse(last.created_at)) / 3_600_000);

  const result = await provider.complete<unknown>({
    instruction: CHECKIN_INSTRUCTION,
    input: [
      context.text,
      '',
      voiceNote(isVoice(settings.abood_voice) ? settings.abood_voice : null),
      memory.length ? `WHAT YOU REMEMBER\n${memory.map((f) => `- ${f}`).join('\n')}\n` : '',
      history ? `YOUR LAST CONVERSATION (about ${hours} hours ago)\n${history}` : '',
    ].join('\n'),
    schema: CHECKIN_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.9,
    reasoning: 'low',
    maxOutputTokens: 600,
    timeoutMs: 30_000,
  });
  await recordUse(admin, userId, 'chat', today, onOwnKey);
  if (!result.ok) return `model: ${result.failure}`;

  const titles = context.titles;
  const raw = (result.value as { texts?: unknown })?.texts;
  const texts = (Array.isArray(raw) ? raw : [])
    .filter((t): t is string => typeof t === 'string')
    .map((t) =>
      t
        .trim()
        .replace(/\[?\b([wecm]\d{1,3})\b\]?/g, (whole, l: string) => titles?.get(l) ?? whole)
        .slice(0, 400),
    )
    .filter(Boolean)
    .slice(0, 3);
  if (texts.length === 0) return 'nothing written';

  await deliver(admin, userId, channel, texts);
  return `sent via ${channel.via}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (!sameSecret(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return new Response('unauthorised', { status: 401 });
  }
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const { data: accounts } = await admin
    .from('app_settings')
    .select(
      'user_id, timezone, gemini_api_key, groq_api_key, abood_checkins, abood_checkin_every_hours, abood_checkin_from, abood_checkin_until, abood_voice, abood_morning, abood_morning_hour, abood_morning_sent_on',
    )
    .or('abood_checkins.eq.true,abood_morning.eq.true');

  const results: Record<string, string> = {};
  for (const a of (accounts ?? []) as Record<string, unknown>[]) {
    try {
      results[String(a.user_id).slice(0, 8)] = await checkIn(admin, a.user_id as string, a);
    } catch (e) {
      console.error('[checkin]', e);
      results[String(a.user_id).slice(0, 8)] = 'error';
    }
  }
  return new Response(JSON.stringify(results), { headers: { 'content-type': 'application/json' } });
});

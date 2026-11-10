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
 * COST
 *   One small model call per check-in — at most one per quiet stretch, so
 *   about one a day for someone who talks daily, against dozens of chat
 *   calls. It is counted against the same daily chat budget.
 */

import { sameSecret } from '../_shared/secret.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { datedFact, gatherContext, recall } from '../_shared/abood.ts';
import { textsOf } from '../_shared/door.ts';
import { geminiProvider } from '../_shared/llm/gemini.ts';
import { groqProvider } from '../_shared/llm/groq.ts';
import { withFallback } from '../_shared/llm/chain.ts';
import { meterFor, release, reserve } from '../_shared/budget.ts';
import { scripted } from '../_shared/chat.ts';
import { checkinSignal, type Due, type Slot } from '../_shared/signals.ts';
import { endOfDayUTC, localDayKey, localHourMinute, startOfDayUTC } from '../_shared/time.ts';

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
/**
 * Something happening in their day (see _shared/signals.ts) can bring a
 * check-in forward, but only after this long without a message, at most once
 * a local day, and never into an unanswered one.
 */
const SIGNAL_QUIET_HOURS = Number(env('ABOOD_SIGNAL_QUIET_HOURS') || '3');

// deno-lint-ignore no-explicit-any
type Admin = any;

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
  'Never guilt them: no "you haven\'t talked to me", no "where have you been",',
  'no counting days, no streaks. Mention the planner only if something is due',
  'today or tomorrow and there is nothing more personal to pick up, and then',
  'lightly, in passing. Never invent a fact about their',
  'planner; only use what is shown. Refer to items by name, never by labels',
  'like [w2].',
  'WHAT YOU REMEMBER is led by the day they told you each thing: when you',
  'bring one back, say when the way a friend would, worked out from today.',
  'If the last conversation is old or finished and nothing in it is worth',
  'picking up, you may instead ask about something under THINGS YOU COULD BE',
  'CURIOUS ABOUT: one concrete question you actually wonder about, dropped in',
  'as a passing thought, never an interview.',
  'If there is a RIGHT NOW line, it is what is actually happening in their',
  'day and is the reason you are texting now. Still text as a friend: if',
  'they are in the middle of something, a light word about it; if things are',
  'due tonight, mention the free stretch once as an option, never an order,',
  'and only after anything personal. Use the times exactly as written there.',
  'Your first text must not start the way your recent check-ins did.',
  'Return only the JSON.',
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
    // The account's own bridge: a Mac someone else runs never carries this
    // account's check-ins.
    admin.from('imessage_bridges').select('last_seen').eq('user_id', userId).maybeSingle(),
    admin.from('notification_channels').select('config').eq('user_id', userId).eq('kind', 'telegram').eq('enabled', true).limit(1),
  ]);
  const bridgeUp = bridge?.last_seen && Date.now() - Date.parse(bridge.last_seen) < 10 * 60_000;
  if (link?.[0]?.handle && bridgeUp) return { via: 'imessage' as const, handle: link[0].handle as string };
  const chatId = tg?.[0]?.config?.chat_id as string | undefined;
  if (chatId && BOT) return { via: 'telegram' as const, chatId };
  return null;
}

/** Today's timed items and what is due today, turned into one sentence or null. */
async function signalFor(admin: Admin, userId: string, tz: string): Promise<string | null> {
  const now = new Date();
  const day = localDayKey(now, tz);
  const from = startOfDayUTC(day, tz).toISOString();
  const to = endOfDayUTC(day, tz).toISOString();
  const [{ data: events }, { data: blocks }, { data: work }] = await Promise.all([
    admin.from('events').select('title, starts_at, ends_at').eq('user_id', userId).eq('all_day', false).gte('starts_at', from).lte('starts_at', to),
    admin
      .from('planned_blocks')
      .select('starts_at, minutes, state, assignments(title)')
      .eq('user_id', userId)
      .neq('state', 'skipped')
      .gte('starts_at', from)
      .lte('starts_at', to),
    admin
      .from('assignments')
      .select('title, due_at')
      .eq('user_id', userId)
      .neq('status', 'done')
      .eq('due_has_time', true)
      .gte('due_at', now.toISOString())
      .lte('due_at', to),
  ]);
  const hour = 3_600_000;
  const slots: Slot[] = [
    ...((events ?? []) as { title: string; starts_at: string; ends_at: string | null }[]).map((e) => ({
      title: e.title,
      start: new Date(e.starts_at),
      end: e.ends_at ? new Date(e.ends_at) : new Date(Date.parse(e.starts_at) + hour),
    })),
    ...((blocks ?? []) as { starts_at: string; minutes: number; assignments: { title: string } | null }[]).map((b) => ({
      title: `work block for ${b.assignments?.title ?? 'an assignment'}`,
      start: new Date(b.starts_at),
      end: new Date(Date.parse(b.starts_at) + b.minutes * 60_000),
    })),
  ];
  const dues: Due[] = ((work ?? []) as { title: string; due_at: string }[]).map((w) => ({ title: w.title, due: new Date(w.due_at) }));
  return checkinSignal(now, slots, dues, tz);
}

/** A few facts to be curious about, picked at random so it is not the same one every time. */
function pickSeeds<T>(rows: T[], n: number): T[] {
  const pool = [...rows];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

async function checkIn(admin: Admin, userId: string, settings: Record<string, unknown>): Promise<string> {
  const tz = ((settings.timezone as string | null) ?? 'UTC').trim() || 'UTC';
  const { hour } = localHourMinute(new Date(), tz);
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
    if (unanswered.length) return 'already checked in';
  }
  const quietMs = Date.now() - Date.parse(last.created_at);
  const signal = await signalFor(admin, userId, tz);
  if (!every && quietMs < QUIET_HOURS * 3_600_000) {
    // Not quiet long enough for an ordinary check-in; only a signal can bring one forward.
    if (!signal) return 'not quiet';
    if (quietMs < SIGNAL_QUIET_HOURS * 3_600_000) return 'talked recently';
    const { data: todays } = await admin
      .from('chat_messages')
      .select('id')
      .eq('user_id', userId)
      .eq('checkin', true)
      .gte('created_at', startOfDayUTC(localDayKey(new Date(), tz), tz).toISOString())
      .limit(1);
    if (todays?.length) return 'already checked in today';
  }

  const channel = await channelFor(admin, userId);
  if (!channel) return 'no text channel';

  const rawGemini = (settings.gemini_api_key as string | null)?.trim() || null;
  const ownGemini = rawGemini && !rawGemini.startsWith('gsk_') ? rawGemini : null;
  const rawGroq = (settings.groq_api_key as string | null)?.trim() || null;
  const ownGroq = rawGroq && !rawGroq.startsWith('AIza') ? rawGroq : null;
  const geminiKey = ownGemini ?? env('GEMINI_API_KEY');
  const gemini = geminiProvider(geminiKey);
  const groqKey = ownGroq ?? env('GROQ_API_KEY');
  const provider = groqKey ? withFallback(groqProvider(groqKey, env('GROQ_MODEL') || undefined), gemini) : gemini;
  const onOwnKey = Boolean(ownGroq || (!groqKey && ownGemini));

  const today = localDayKey(new Date(), tz);
  const slot = await reserve(admin, userId, 'chat', today, onOwnKey);
  if (!slot.allowed) return 'over budget';

  const [context, memory, { data: turns }, { data: older }, { data: recent }] = await Promise.all([
    gatherContext(admin, userId, today, tz, { scopes: new Set(), shortIds: true }),
    recall(admin, userId, last.content, geminiKey, tz, meterFor(admin, userId, 'embed', today, Boolean(ownGemini))),
    admin
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', userId)
      .eq('failed', false)
      .order('created_at', { ascending: false })
      .limit(6),
    admin.from('memory_facts').select('fact, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(60),
    // Their last few check-ins, so a new one cannot open the same way.
    admin
      .from('chat_messages')
      .select('content')
      .eq('user_id', userId)
      .eq('checkin', true)
      .order('created_at', { ascending: false })
      .limit(3),
  ]);
  const remembered = new Set(memory.map((m) => m.slice(m.indexOf(': ') + 2)));
  const seeds = pickSeeds(((older ?? []) as { fact: string; created_at: string }[]).filter((r) => !remembered.has(r.fact)), 3)
    .map((r) => datedFact(r.fact, r.created_at, tz));
  const earlierCheckins = ((recent ?? []) as { content: string }[]).map((r) => r.content);

  const history = ((turns ?? []) as { role: string; content: string }[])
    .reverse()
    .map((t) => `${t.role === 'user' ? 'They said' : 'You said'}: ${t.content.slice(0, 300)}`)
    .join('\n');
  const hours = Math.round((Date.now() - Date.parse(last.created_at)) / 3_600_000);

  const input = [
    context.text,
    '',
    signal ? `RIGHT NOW\n${signal}\n` : '',
    memory.length ? `WHAT YOU REMEMBER\n${memory.map((f) => `- ${f}`).join('\n')}\n` : '',
    seeds.length ? `THINGS YOU COULD BE CURIOUS ABOUT\n${seeds.map((f) => `- ${f}`).join('\n')}\n` : '',
    history ? `YOUR LAST CONVERSATION (about ${hours} hours ago)\n${history}\n` : '',
    earlierCheckins.length ? `YOUR RECENT CHECK-INS (do not open the same way)\n${earlierCheckins.map((c) => `- ${c.slice(0, 200)}`).join('\n')}` : '',
  ].join('\n');

  const write = async (redo = '') => {
    const result = await provider.complete<unknown>({
      instruction: CHECKIN_INSTRUCTION,
      input: input + redo,
      schema: CHECKIN_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.8,
      reasoning: 'low',
      maxOutputTokens: 600,
      timeoutMs: 30_000,
    });
    if (!result.ok) return { failure: result.failure, texts: [] as string[] };
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
    return { failure: null, texts };
  };

  const first = await write();
  if (first.failure) {
    await release(admin, userId, 'chat', today, slot);
    return `model: ${first.failure}`;
  }
  let texts = first.texts;
  if (texts.length === 0) return 'nothing written';

  // Same opener as a recent check-in, or a scripted line: rewritten once, on a
  // second budget slot; still wrong, nothing is sent, since a repeated text is
  // exactly what makes a friend sound like a bot.
  const problems = scripted(texts.join('\n\n'), earlierCheckins);
  if (problems.length) {
    const again = await reserve(admin, userId, 'chat', today, onOwnKey);
    if (!again.allowed) return 'scripted, over budget';
    const second = await write(`\n\nYOU DRAFTED THIS AND IT SOUNDS SCRIPTED:\n${texts.join('\n\n')}\nWhat gave it away: ${problems.join('; ')}.\nWrite it again.`);
    if (second.failure) await release(admin, userId, 'chat', today, again);
    if (second.failure || !second.texts.length || scripted(second.texts.join('\n\n'), earlierCheckins).length) return 'scripted';
    texts = second.texts;
  }

  await admin.from('chat_messages').insert({
    user_id: userId,
    role: 'assistant',
    content: texts.join('\n\n'),
    via: channel.via,
    checkin: true,
  });

  if (channel.via === 'imessage') {
    await admin.from('imessage_outbox').insert(texts.map((body) => ({ user_id: userId, handle: channel.handle, body })));
  } else {
    for (const [i, t] of textsOf(texts.join('\n\n')).entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 900));
      await tgSend(channel.chatId, t);
    }
  }
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
    .select('user_id, timezone, gemini_api_key, groq_api_key, abood_checkin_every_hours, abood_checkin_from, abood_checkin_until')
    .eq('abood_checkins', true)
    // Abood switched off as a module: its check-ins stop with it.
    .not('modules_off', 'cs', '{abood}');

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

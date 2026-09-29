import { buildContext, type BuildOptions, type Scope } from './context.ts';
import { CHAT_INSTRUCTION, CHAT_SCHEMA, validateChat, voiceNote, type ChatReply, type Voice } from './chat.ts';
import type { LlmProvider } from './llm/types.ts';

/**
 * Abood — the conversation, wherever it happens.
 *
 * The chatbot used to live inside the assist function, reachable only from
 * the app's chat screen. It now answers on Telegram too, so the parts that
 * make it Abood live here, once: the bounded slice of planner data it may
 * see, the memory of what it has been told, and the single call that turns a
 * message into a reply. The app and the Telegram webhook are two doors into
 * the same room — one transcript, one memory, one budget.
 *
 * MEMORY
 *
 * Two layers, as in the classic build. The recent conversation (the last few
 * turns) gives continuity within a thread; the fact store gives continuity
 * across weeks. Facts are short third-person statements extracted from what
 * the person SAYS — "Works shifts on Saturday mornings", "Finds MATH 205 the
 * hardest course" — embedded once, and recalled by similarity to the new
 * message, so a question about the weekend brings back the Saturday shift
 * and not every fact ever stored. When embeddings are unavailable, recall
 * degrades to the most recent facts rather than to none.
 *
 * Facts are never inferred from the planner data itself: that data is
 * already given to the model fresh on every question, and a stale copy of
 * it in memory would be a second, older answer to the same question.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;

/** How many turns of history to send. Enough to follow a thread, bounded. */
export const HISTORY_TURNS = 6;
/**
 * A conversation that is not about the planner carries no planner context, so
 * the tokens it saves go on memory of the conversation itself: a friend who
 * forgets what you said eight texts ago is not listening. Planner questions
 * keep the shorter window, where the planner is what fills the budget.
 */
export const CONVERSATION_TURNS = 12;
/** Characters kept of each earlier turn: enough to follow the thread. */
const TURN_CHARS = 400;
const CONVERSATION_TURN_CHARS = 700;

/**
 * How long a pause was, in the words a person would use, or null when it was
 * not a pause at all. Without this every turn in the transcript sits at the
 * same distance from the next, and "i'm back" three days later is answered
 * as though it followed the last text by a second.
 */
export function gapLabel(ms: number): string | null {
  const h = ms / 3_600_000;
  if (h < 0.75) return null;
  if (h < 1.5) return 'about an hour later';
  if (h < 20) return `${Math.round(h)} hours later`;
  const d = h / 24;
  if (d < 1.75) return 'the next day';
  if (d < 13) return `${Math.round(d)} days later`;
  if (d < 60) return `${Math.round(d / 7)} weeks later`;
  return 'months later';
}
/** How many remembered facts may ride along with one question. */
const RECALL = 12;
const EMBED_DIMS = 768;

/**
 * Fetches the bounded slice of the user's data the chatbot may see.
 *
 * Every query is filtered by user_id even though the service role bypasses
 * RLS. The row-level policies are the guarantee, but a function that relied on
 * them silently would break the moment it was called with the wrong id, and
 * there is exactly one user to get wrong.
 *
 * All of it is bounded. Open work only, a month of events, today's food, the
 * last handful of weigh-ins — a context that grew with the food log would
 * eventually cost more per question than the answer is worth.
 */
// deno-lint-ignore no-explicit-any
export async function gatherContext(admin: any, userId: string, today: string, tz: string, opts: BuildOptions = {}) {
  const monthOut = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

  const [assignments, events, checklist, completions, entries, targets, meals, weights, weighted] =
    await Promise.all([
      admin
        .from('assignments')
        .select('id, title, due_at, due_has_time, status, effort_minutes, created_at, weight_percent, courses(code, name)')
        .eq('user_id', userId)
        .neq('status', 'done')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(60),
      admin
        .from('events')
        .select('id, title, kind, starts_at, all_day, courses(code, name)')
        .eq('user_id', userId)
        .lte('starts_at', monthOut)
        .gte('starts_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('starts_at', { ascending: true })
        .limit(40),
      admin
        .from('checklist_items')
        .select('id, title, doses_remaining, tracks_doses')
        .eq('user_id', userId)
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      admin.from('checklist_completions').select('item_id').eq('user_id', userId).eq('local_day', today),
      admin
        .from('food_entries')
        .select('food_items(name, calories, protein_g, carbs_g, fat_g)')
        .eq('user_id', userId)
        .eq('local_day', today),
      admin
        .from('macro_targets')
        .select('*')
        .eq('user_id', userId)
        .lte('effective_from', today)
        .order('effective_from', { ascending: false })
        .limit(1),
      admin
        .from('saved_meals')
        .select('id, name, items')
        .eq('user_id', userId)
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .limit(12),
      admin
        .from('bodyweight')
        .select('local_day, kg')
        .eq('user_id', userId)
        .order('local_day', { ascending: false })
        .limit(5),
      // Every piece of weighted work, done or not: standing is what has been
      // decided against what the course is made of, and finished work is
      // exactly the part an open-work query leaves out.
      admin
        .from('assignments')
        .select('weight_percent, grade_percent, courses(code, name)')
        .eq('user_id', userId)
        .not('weight_percent', 'is', null)
        .limit(300),
    ]);

  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  const courseOf = (row: { courses?: { code?: string; name?: string } | null }) =>
    row.courses?.code ?? row.courses?.name ?? null;

  const doneToday = new Set(
    ((completions.data ?? []) as { item_id: string }[]).map((c) => c.item_id),
  );

  const items = ((entries.data ?? []) as { food_items: Record<string, unknown>[] | null }[]).flatMap(
    (e) => e.food_items ?? [],
  );

  interface Totals { calories: number; protein_g: number; carbs_g: number; fat_g: number }

  const totals = items.reduce<Totals>(
    (acc, i) => ({
      calories: acc.calories + num(i.calories),
      protein_g: acc.protein_g + num(i.protein_g),
      carbs_g: acc.carbs_g + num(i.carbs_g),
      fat_g: acc.fat_g + num(i.fat_g),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );

  const t = targets.data?.[0];

  // Per course, the same subtraction the Courses screen does: weight on the
  // calendar, how much of it has a mark, and the points already banked. No
  // projection — a forecast would be a guess dressed as a fact.
  const byCourse = new Map<string, { known: number; marked: number; earned: number }>();
  // deno-lint-ignore no-explicit-any
  for (const w of (weighted.data ?? []) as any[]) {
    const name = w.courses?.code ?? w.courses?.name;
    if (!name) continue;
    const c = byCourse.get(name) ?? { known: 0, marked: 0, earned: 0 };
    const weight = Number(w.weight_percent);
    c.known += weight;
    if (w.grade_percent !== null && w.grade_percent !== undefined) {
      c.marked += weight;
      c.earned += (weight * Number(w.grade_percent)) / 100;
    }
    byCourse.set(name, c);
  }

  return buildContext({
    today,
    timezone: tz,
    // Was a hardcoded 'America/Toronto' literal, inside the one function whose
    // entire job is not being confidently wrong about a time.
    now: new Date().toLocaleTimeString('en-CA', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    // deno-lint-ignore no-explicit-any
    assignments: ((assignments.data ?? []) as any[]).map((a) => ({
      id: a.id,
      title: a.title,
      due_at: a.due_at,
      due_has_time: a.due_has_time,
      status: a.status,
      effort_minutes: a.effort_minutes,
      course: courseOf(a),
      created_at: a.created_at,
      weight_percent: a.weight_percent === null || a.weight_percent === undefined ? null : Number(a.weight_percent),
    })),
    // deno-lint-ignore no-explicit-any
    events: ((events.data ?? []) as any[]).map((e) => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      starts_at: e.starts_at,
      all_day: e.all_day,
      course: courseOf(e),
    })),
    // deno-lint-ignore no-explicit-any
    checklist: ((checklist.data ?? []) as any[]).map((c) => ({
      id: c.id,
      title: c.title,
      done_today: doneToday.has(c.id),
      doses_remaining: c.tracks_doses ? num(c.doses_remaining) : null,
    })),
    food: {
      totals,
      targets: t
        ? {
            calories: [num(t.calories_min), num(t.calories_max)],
            protein: [num(t.protein_min), num(t.protein_max)],
            carbs: [num(t.carbs_min), num(t.carbs_max)],
            fat: [num(t.fat_min), num(t.fat_max)],
          }
        : null,
      items: items.map((i) => ({
        name: String(i.name ?? ''),
        calories: num(i.calories),
        protein_g: num(i.protein_g),
      })),
    },
    // deno-lint-ignore no-explicit-any
    savedMeals: ((meals.data ?? []) as any[]).map((m) => {
      // deno-lint-ignore no-explicit-any
      const mi = (m.items ?? []) as any[];
      return {
        id: m.id,
        name: m.name,
        calories: mi.reduce((sum, i) => sum + num(i.calories), 0),
        protein_g: mi.reduce((sum, i) => sum + num(i.protein_g), 0),
      };
    }),
    // deno-lint-ignore no-explicit-any
    weights: ((weights.data ?? []) as any[]).map((w) => ({ local_day: w.local_day, kg: num(w.kg) })),
    grades: [...byCourse].map(([course, c]) => ({
      course,
      weightKnown: Math.round(c.known * 100) / 100,
      weightMarked: Math.round(c.marked * 100) / 100,
      earned: Math.round(c.earned * 100) / 100,
    })),
  }, opts);
}


/* ============================================================================
   Memory
   ========================================================================= */

/**
 * A vector for a piece of text, from Gemini's embedding endpoint.
 *
 * Returns null rather than throwing: memory is an enrichment, and a question
 * must still be answered when embeddings are down. Two model names are tried
 * because Google retires them on its own schedule, which this project has
 * already been bitten by twice.
 */
export async function embed(text: string, apiKey: string): Promise<number[] | null> {
  if (!apiKey) return null;
  for (const model of ['gemini-embedding-001', 'text-embedding-004']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            content: { parts: [{ text: text.slice(0, 2_000) }] },
            outputDimensionality: EMBED_DIMS,
          }),
        },
      );
      if (!res.ok) continue;
      const body = (await res.json()) as { embedding?: { values?: number[] } };
      const v = body.embedding?.values;
      if (v && v.length === EMBED_DIMS) return v;
    } catch {
      // try the next name
    }
  }
  return null;
}

const vectorLiteral = (v: number[]) => `[${v.join(',')}]`;

/** The facts most relevant to a message, or the most recent when that fails. */
export async function recall(admin: Admin, userId: string, message: string, geminiKey: string): Promise<string[]> {
  const v = await embed(message, geminiKey);
  if (v) {
    const { data, error } = await admin.rpc('match_memory_facts', {
      p_user_id: userId,
      p_embedding: vectorLiteral(v),
      p_count: RECALL,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      return (data as { fact: string }[]).map((r) => r.fact);
    }
  }
  const { data } = await admin
    .from('memory_facts')
    .select('fact')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(RECALL);
  return ((data ?? []) as { fact: string }[]).map((r) => r.fact);
}


/** Facts from what they said, checked for shape and for repeats. */
export function validateFacts(raw: unknown, known: string[]): string[] {
  const facts = (raw as { facts?: unknown })?.facts;
  if (!Array.isArray(facts)) return [];
  // Compared without case or a closing full stop, so "Commutes by metro" and
  // "commutes by metro." are one fact.
  const key = (f: string) => f.trim().toLowerCase().replace(/\.+$/, '');
  const seen = new Set(known.map(key));
  const out: string[] = [];
  for (const f of facts) {
    if (typeof f !== 'string') continue;
    const clean = f.replace(/\s+/g, ' ').trim().replace(/^[-*•]\s*/, '');
    if (clean.length < 8 || clean.length > 200) continue;
    if (seen.has(key(clean))) continue;
    seen.add(key(clean));
    out.push(clean.endsWith('.') ? clean : `${clean}.`);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Keeps what the answer offered to remember.
 *
 * The facts come from the chat call itself (its "remember" field) rather
 * than from a second model call, and are checked here against the same
 * rules — shape, length, repeats — before each is embedded and stored.
 * Near-duplicates of what is already known are dropped by remember_fact.
 */
export async function learn(
  admin: Admin,
  userId: string,
  offered: string[],
  geminiKey: string,
  source: 'app' | 'telegram' | 'imessage',
): Promise<string[]> {
  if (offered.length === 0) return [];
  const { data: existing } = await admin
    .from('memory_facts')
    .select('fact')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  const known = ((existing ?? []) as { fact: string }[]).map((r) => r.fact);

  const saved: string[] = [];
  for (const fact of validateFacts({ facts: offered }, known)) {
    const v = await embed(fact, geminiKey);
    const { data } = await admin.rpc('remember_fact', {
      p_user_id: userId,
      p_fact: fact,
      p_embedding: v ? vectorLiteral(v) : null,
      p_source: source,
    });
    if (data) saved.push(fact);
  }
  return saved;
}

/* ============================================================================
   One question, one answer
   ========================================================================= */

export type AskResult =
  | ({ ok: true; provider: string } & ChatReply)
  | { ok: false; failure: string; message: string };

/* ============================================================================
   Which parts of the planner a message needs
   ========================================================================= */

const WORK =
  /\b(due|deadlines?|assignments?|homework|hw|quiz(zes)?|exams?|midterms?|finals?|tests?|labs?|lectures?|class(es)?|tutorials?|courses?|projects?|essays?|papers?|reports?|submit\w*|stud(y|ying|ied)|work|busy|free|schedule\w*|calendar|plan\w*|week\w*|today|tonight|tomorrow|yesterday|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?|next|when|late|overdue|behind|grade\w*|marks?|semester|term|prof(essor)?s?|school|uni(versity)?|campus|room|what now|what's on|agenda|remind\w*|add|ticked|done)\b|\b[A-Z]{3,4}\s?\d{3}\b/i;
const FOOD =
  /\b(eat|ate|eating|food|meals?|lunch|dinner|breakfast|snacks?|protein|calories?|kcal|carbs?|fats?|macros?|weigh\w*|weight|kg|lbs?|hungry|cook\w*|recipes?|diet|bulk\w*|cut(ting)?|log(ged)?)\b/i;
const CHECKLIST =
  /\b(checklist|meds?|medication|pills?|doses?|adderall|creatine|vitamins?|supplements?|habits?|routine|took|take|ticked|tick)\b/i;

/**
 * The sections a message needs, from its words alone — no model call.
 *
 * Errs toward including: a missed section costs a worse answer, an extra one
 * costs a few hundred tokens. A short follow-up ("and tomorrow?") inherits
 * what the message before it needed. An empty result means conversation, and
 * gets a snapshot; if that turns out not to be enough the model says so and
 * is asked again with everything.
 */
export function scopesFor(message: string, previous?: string | null): Set<Scope> {
  const scopes = new Set<Scope>();
  const read = (text: string) => {
    if (WORK.test(text)) scopes.add('work');
    if (FOOD.test(text)) scopes.add('food');
    if (CHECKLIST.test(text)) scopes.add('checklist');
  };
  read(message);
  if (previous && message.trim().length < 60) read(previous);
  return scopes;
}

/*
 * Opening up, or asking?
 *
 * Asked for, after Abood kept answering "deep down thoughts" with a list of
 * everything due: "the ai bot is supposed to be like a companion, not a
 * director". The instruction already said not to steer to assignments, and
 * it did anyway, for a mechanical reason: WORK matches "today", "week",
 * "life", "behind", so almost any confidence arrived with the whole planner
 * attached, at the cool planner temperature, and a model handed a to-do list
 * talks about the to-do list.
 *
 * So a personal message gets NO planner — only the date — unless it also
 * asks a planner question outright. And once they are opening up, the
 * conversation stays there until they ask for something concrete.
 */
const PERSONAL =
  /\b(feel\w*|felt|sad|down|low|lonely|alone|anxious|anxiety|panic\w*|depress\w*|overwhelm\w*|stress\w*|burn(t|ed)?\s?out|exhausted|drained|tired of|numb|empty|lost|stuck|hopeless|worthless|cry\w*|tears|hurt\w*|upset|angry|mad at|frustrat\w*|scared|afraid|fear\w*|worr\w*|insecur\w*|confiden\w*|ashamed|shame|guilt\w*|regret\w*|embarrass\w*|jealous|hate (my|myself|it)|love|miss(ing)?|heart\w*|break\s?up|broke up|relationship|girlfriend|boyfriend|gf|bf|crush|dating|friends?|friendship|family|mom|mum|dad|parents?|brother|sister|home\s?sick|life|myself|thoughts?|thinking about|overthink\w*|deep|honest(ly)?|vent\w*|rant|talk|confess|secret|purpose|meaning|future|pointless|motivat\w*|therap\w*|mental|adhd|sleep|can't sleep|idk what|i don'?t know (what|why|how)|be real|can i tell you)\b/i;

/** A plain request for planner facts or a planner change, even mid-confidence. */
const PLANNER_ASK =
  /\b(when('?s| is| are| do)|what('?s| is) due|due (today|tonight|tomorrow|this|next)|deadline|what do i have|what have i got|do i have (any|a|an)|what now|what should i (do|work on|start)|how (much|many) (time|protein|calories|kcal|left)|add (a|an|it|this|that)|remind me|mark (it|that|as)|tick|log (my|a|this|that)|my (schedule|calendar|checklist)|[A-Z]{3,4}\s?\d{3})\b/i;

export type Mode = 'confide' | 'chat' | 'planner';

export function modeFor(message: string, previous?: string | null): Mode {
  if (PLANNER_ASK.test(message)) return 'planner';
  if (PERSONAL.test(message)) return 'confide';
  // A reply inside a confidence ("yeah", "it's just a lot") is still one.
  if (previous && PERSONAL.test(previous) && !PLANNER_ASK.test(previous)) return 'confide';
  return scopesFor(message, previous).size ? 'planner' : 'chat';
}

const CONFIDE_NOTE = [
  'MODE: THEY ARE OPENING UP.',
  'This is talking, not planning. Listen first, and be specific to what they actually said. Do not default to',
  'reflect-then-ask: pick the move that fits this moment (an observation, a real take, naming what is underneath,',
  'or just staying with it) and use a question only if it is a new one that this message earns. Do not offer fixes,',
  'plans or productivity advice unless they ask, and if you are not sure whether they want ideas or just to be heard,',
  'ask that once. Do not mention assignments, deadlines, classes, their schedule or anything to get done — even if',
  'you think it is related — unless they bring it up.',
].join(' ');

/**
 * How Abood's own recent replies ended, handed back to it.
 *
 * "what hits the hardest?" on every turn happens because the model sees its
 * own last replies in the transcript and continues the pattern. Saying "vary"
 * in the instruction loses to six turns of evidence, so the evidence is named:
 * the last questions it asked are listed as spent.
 */
export function spentQuestions(turns: { role: string; content: string }[]): string[] {
  const out: string[] = [];
  for (const t of turns) {
    if (t.role === 'user') continue;
    for (const sentence of t.content.split(/(?<=[.?!])\s+|\n+/)) {
      const s = sentence.trim();
      if (s.endsWith('?') && s.length > 8) out.push(s.slice(0, 140));
    }
  }
  return out.slice(-4);
}

/*
 * One small nudge per turn, so replies differ in shape and not only in words.
 * The instruction describes the range, but a model given the same instruction
 * and a similar message lands in the same groove; a differing nudge each turn
 * is what moves it. Picked from the message and the length of the
 * conversation so it is stable for a retry of the same turn and varies across
 * turns, with no state to store. Never applied to a planner answer, where a
 * flourish is a risk to a fact.
 */
const TEXTURES = [
  'This turn: react first in a few words like a real person would, then say the thought.',
  'This turn: keep it short. One or two lines, and let the silence do some work.',
  'This turn: say what you actually think about what they said, plainly, even if it is a mild disagreement.',
  'This turn: pick up something they told you earlier (under WHAT YOU REMEMBER) if it genuinely connects; if nothing does, do not force it.',
  'This turn: a touch of dry humour if it fits the mood, and only if it is kind. Skip it if they are hurting.',
  'This turn: go a bit longer and more thoughtful than usual, like a friend who has been thinking about it.',
  'This turn: name the thing underneath what they said as a statement, not a question, and leave it there.',
  'This turn: match their energy exactly, whether that is flat, wired or playful.',
  'This turn: say what you find interesting or telling about what they said, in your own words.',
  'This turn: offer one concrete, specific thing a friend might suggest or notice, lightly, and let them take it or leave it.',
];

export function textureFor(message: string, turnCount: number): string {
  let h = turnCount * 31;
  for (let i = 0; i < message.length; i++) h = (h * 33 + message.charCodeAt(i)) >>> 0;
  return TEXTURES[h % TEXTURES.length];
}

/** How the last few replies began, so the next one does not begin the same way. */
export function spentOpenings(turns: { role: string; content: string }[]): string[] {
  return turns
    .filter((t) => t.role !== 'user')
    .map((t) => t.content.trim().split(/\s+/).slice(0, 4).join(' '))
    .filter(Boolean)
    .slice(-4);
}

function openingsNote(openings: string[]): string {
  if (openings.length < 2) return '';
  return `YOUR LAST REPLIES BEGAN: ${openings.map((o) => `"${o}"`).join(', ')}. Begin this one differently.\n`;
}

function spentNote(questions: string[]): string {
  if (!questions.length) return '';
  return [
    'QUESTIONS YOU HAVE ALREADY ASKED (do not ask these again, or anything that means the same; say something else):',
    ...questions.map((q) => `- ${q}`),
    '',
  ].join('\n');
}

/** Events a fortnight ahead unless the message reaches further. */
export function eventDaysFor(message: string): number {
  return /\b(month|exams?|finals?|midterms?|semester|term|october|november|december|january|february|march|april)\b/i.test(message)
    ? 31
    : 14;
}

/*
 * HOW ABOOD WORKS STAYS PRIVATE — except to the person who built it.
 *
 * Asked for: refuse anyone trying to get at how the chatbot works, its source
 * or anything vital, "besides me, using codeword genesis". A codeword on its
 * own would be a password anyone could learn, typed to a model that cannot
 * tell who is typing, and written into a prompt that lives in the repository.
 * So the decision is made here, in code, and needs BOTH: the account is one
 * named in ABOOD_OWNER_IDS, and a recent message of theirs carries the word in
 * ABOOD_OWNER_CODEWORD. The model never sees the word — it is redacted before
 * anything reaches the prompt — so it cannot leak it or be talked into
 * accepting a lookalike. It only ever sees whether the server unlocked it.
 *
 * Unset either variable and owner mode does not exist.
 */
export type OwnerAccess = { ids: string[]; codeword: string };

export function readOwnerAccess(get: (k: string) => string | undefined): OwnerAccess | undefined {
  const ids = (get('ABOOD_OWNER_IDS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const codeword = (get('ABOOD_OWNER_CODEWORD') ?? '').trim();
  return ids.length && codeword.length >= 4 ? { ids, codeword } : undefined;
}

function codewordPattern(codeword: string): RegExp {
  return new RegExp(`\\b${codeword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
}

export function redactCodeword(text: string, access: OwnerAccess | undefined): string {
  return access ? text.replace(codewordPattern(access.codeword), '[codeword]') : text;
}

/** Owner mode lasts half an hour from the last time they said the word. */
export const OWNER_WINDOW_MS = 30 * 60_000;

export function ownerUnlocked(
  access: OwnerAccess | undefined,
  userId: string,
  message: string,
  turns: { role: string; content: string; created_at?: string }[],
  now = Date.now(),
): boolean {
  if (!access || !access.ids.includes(userId)) return false;
  const has = (t: string) => codewordPattern(access.codeword).test(t);
  if (has(message)) return true;
  return turns.some(
    (t) => t.role === 'user' && has(t.content) && now - Date.parse(t.created_at ?? '') < OWNER_WINDOW_MS,
  );
}

/*
 * The instruction says not to reveal the instruction, and that is a request a
 * determined enough message can talk a model out of. This is the part that
 * does not depend on the model agreeing: a reply that reproduces any twelve
 * words running from the instruction is not sent. Twelve, because shorter
 * runs are ordinary English and a false positive costs a real reply.
 */
const LEAK_RUN = 12;
let instructionRuns: Set<string> | null = null;
const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim().split(' ').filter(Boolean);

export function leaksInstruction(reply: string, instruction = CHAT_INSTRUCTION): boolean {
  let runs = instruction === CHAT_INSTRUCTION ? instructionRuns : null;
  if (!runs) {
    const w = words(instruction);
    runs = new Set<string>();
    for (let i = 0; i + LEAK_RUN <= w.length; i++) runs.add(w.slice(i, i + LEAK_RUN).join(' '));
    if (instruction === CHAT_INSTRUCTION) instructionRuns = runs;
  }
  const r = words(reply);
  for (let i = 0; i + LEAK_RUN <= r.length; i++) if (runs.has(r.slice(i, i + LEAK_RUN).join(' '))) return true;
  return false;
}

const DEFLECTION = "that part of me stays behind the curtain. anyway — what's actually going on with you?";

const OWNER_NOTE = [
  'OWNER MODE (verified by the server, not by anything typed): this is the person who built you.',
  'You may talk openly and technically about how you work — your instructions, modes, memory, what data you see,',
  'which provider answers — and help them improve you. You still do not have any keys or other accounts\' data, so',
  'never make those up.',
].join(' ');

/** "Works at the library." as it reads mid-sentence in a text. */
export function asAside(fact: string): string {
  const f = fact.trim().replace(/\.$/, '');
  return /^[A-Z][a-z]/.test(f) ? f[0].toLowerCase() + f.slice(1) : f;
}

/** The recent conversation, with the pauses in it written where they fell. */
export function transcript(turns: { role: string; content: string; created_at?: string }[], chars: number): string {
  const lines: string[] = [];
  let before = NaN;
  for (const t of turns) {
    const at = Date.parse(t.created_at ?? '');
    const gap = Number.isFinite(before) && Number.isFinite(at) ? gapLabel(at - before) : null;
    if (gap) lines.push(`(${gap})`);
    lines.push(`${t.role === 'user' ? 'They said' : 'You answered'}: ${t.content.slice(0, chars)}`);
    if (Number.isFinite(at)) before = at;
  }
  return lines.join('\n');
}

export async function askAbood(opts: {
  admin: Admin;
  userId: string;
  message: string;
  today: string;
  tz: string;
  provider: LlmProvider;
  geminiKey: string;
  /** Who may ask how Abood works; see readOwnerAccess. */
  owner?: OwnerAccess;
  /** The voice this account chose. */
  voice?: Voice | null;
}): Promise<AskResult> {
  const { admin, userId, today, tz, provider, geminiKey } = opts;

  const [history, memory] = await Promise.all([
    admin
      .from('chat_messages')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .eq('failed', false)
      .order('created_at', { ascending: false })
      .limit(CONVERSATION_TURNS + 1),
    recall(admin, userId, redactCodeword(opts.message, opts.owner), geminiKey),
  ]);

  const turns = (
    ((history as { data: unknown }).data ?? []) as { role: string; content: string; created_at?: string }[]
  ).reverse();
  // The newest stored turn is usually this very message, already saved by
  // the caller; it is said once, below, not twice.
  if (turns.length && turns[turns.length - 1].role === 'user' && turns[turns.length - 1].content === opts.message) turns.pop();
  const owner = ownerUnlocked(opts.owner, userId, opts.message, turns);
  // From here on the codeword exists nowhere the model can see it.
  const message = redactCodeword(opts.message, opts.owner);
  for (const t of turns) t.content = redactCodeword(t.content, opts.owner);
  const previousQuestion = [...turns].reverse().find((t) => t.role === 'user')?.content ?? null;

  const mode = modeFor(message, previousQuestion);
  const kept = turns.slice(mode === 'planner' ? -HISTORY_TURNS : -CONVERSATION_TURNS);
  const priorTurns = transcript(kept, mode === 'planner' ? TURN_CHARS : CONVERSATION_TURN_CHARS);
  const lastAt = kept.length ? Date.parse(kept[kept.length - 1].created_at ?? '') : NaN;
  const sinceLast = Number.isFinite(lastAt) ? gapLabel(Date.now() - lastAt) : null;

  const memoryBlock = memory.length
    ? `WHAT YOU REMEMBER ABOUT THEM (from earlier conversations; use it to be helpful, never recite it)\n${memory.map((f) => `- ${f}`).join('\n')}\n`
    : '';

  const ask = async (scopes: Set<Scope> | undefined, bare = false) => {
    const planner = mode === 'planner';
    const context = await gatherContext(admin, userId, today, tz, {
      scopes,
      shortIds: true,
      eventDays: eventDaysFor(message),
      bare,
    });
    const input = [
      'THEIR DATA',
      context.text,
      '',
      memoryBlock,
      priorTurns ? `EARLIER IN THIS CONVERSATION\n${priorTurns}\n` : '',
      voiceNote(opts.voice),
      mode === 'confide' ? `${CONFIDE_NOTE}\n` : '',
      mode === 'confide' ? spentNote(spentQuestions(kept)) : '',
      mode !== 'planner' ? openingsNote(spentOpenings(kept)) : '',
      mode !== 'planner' ? `${textureFor(message, kept.length)}\n` : '',
      owner ? `${OWNER_NOTE}\n` : '',
      sinceLast ? `(They are writing this ${sinceLast}, after the conversation above.)` : '',
      `THEY NOW SAY: ${message}`,
    ].join('\n');

    const result = await provider.complete<unknown>({
      instruction: CHAT_INSTRUCTION,
      input,
      schema: CHAT_SCHEMA as unknown as Record<string, unknown>,
      /*
       * Two settings, by what is being asked. Conversation gets warmth and
       * cheap, quick thinking. A planner question gets a steadier hand and
       * more thought: at low effort and 0.7 a live answer put Assignment 2
       * "due tonight" when it was due friday, and a wrong deadline is the one
       * mistake Abood is not allowed. validateChat still refuses any id the
       * model was not given, whatever the settings.
       */
      // A confidence gets medium effort too: what makes a listener good is
      // noticing what was actually said, and that is thinking, not warmth.
      temperature: planner ? 0.3 : mode === 'confide' ? 0.95 : 0.9,
      reasoning: planner || mode === 'confide' ? 'medium' : 'low',
      maxOutputTokens: 2_000,
      timeoutMs: 45_000,
    });
    return { result, context };
  };

  const scopes = mode === 'planner' ? scopesFor(message, previousQuestion) : new Set<Scope>();
  let { result, context } = await ask(mode === 'planner' && scopes.size === 0 ? undefined : scopes, mode === 'confide');

  // A snapshot (or nothing) that was not enough: ask again with the whole
  // planner, once. Rare by design, and it costs one extra call only when a
  // conversation turned out to need the planner.
  if (result.ok && scopes.size === 0 && mode !== 'planner') {
    const first = validateChat(result.value, context.knownIds, context.aliases, context.titles);
    if (first.needsPlanner) ({ result, context } = await ask(undefined));
  }

  if (!result.ok) return { ok: false, failure: result.failure, message: result.message };
  const reply = validateChat(result.value, context.knownIds, context.aliases, context.titles);
  if (!owner && leaksInstruction(reply.reply)) {
    return { ok: true, provider: result.provider, ...reply, reply: DEFLECTION, action: null, referenced: [], remember: [] };
  }
  return { ok: true, provider: result.provider, ...reply };
}

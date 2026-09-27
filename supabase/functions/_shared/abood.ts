import { buildContext } from './context.ts';
import { CHAT_INSTRUCTION, CHAT_SCHEMA, validateChat, type ChatReply } from './chat.ts';
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
export const HISTORY_TURNS = 8;
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
export async function gatherContext(admin: any, userId: string, today: string, tz: string) {
  const monthOut = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

  const [assignments, events, checklist, completions, entries, targets, meals, weights] =
    await Promise.all([
      admin
        .from('assignments')
        .select('id, title, due_at, due_has_time, status, effort_minutes, created_at, courses(code, name)')
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
  });
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

export const FACTS_SCHEMA = {
  type: 'object',
  properties: {
    facts: { type: 'array', items: { type: 'string' } },
  },
  required: ['facts'],
} as const;

export const FACTS_INSTRUCTION = [
  'You maintain a short memory about one student for their planner assistant.',
  'From the MESSAGE they just sent, extract facts about them worth remembering',
  'for weeks: preferences, goals, routines, constraints on their time, people',
  'and places that matter to them, how they like to be helped. Write each as a',
  'short third-person sentence without their name, e.g. "Works at the library',
  'on Saturday mornings." At most three. Skip anything temporary (today\'s mood,',
  'a single errand), anything that is only a question, anything already in',
  'KNOWN FACTS, and anything about deadlines, classes, food or weight — the',
  'planner already tracks those. Never record health conditions, medication,',
  'passwords, money details or anything about other people\'s private lives.',
  'If nothing qualifies, return an empty list. Return only the JSON.',
].join(' ');

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
 * Learns from a message, after it has been answered.
 *
 * A near-duplicate of something already known is dropped by the database
 * (see match_memory_facts' sibling, the similarity guard in remember_fact),
 * so saying the same thing twice does not remember it twice.
 */
export async function learn(
  admin: Admin,
  userId: string,
  message: string,
  provider: LlmProvider,
  geminiKey: string,
  source: 'app' | 'telegram',
): Promise<string[]> {
  if (message.trim().length < 12) return [];
  const { data: existing } = await admin
    .from('memory_facts')
    .select('fact')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(80);
  const known = ((existing ?? []) as { fact: string }[]).map((r) => r.fact);

  const result = await provider.complete<unknown>({
    instruction: FACTS_INSTRUCTION,
    input: `KNOWN FACTS\n${known.map((f) => `- ${f}`).join('\n') || '(none)'}\n\nMESSAGE\n${message}`,
    schema: FACTS_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: 20_000,
  });
  if (!result.ok) return [];

  const saved: string[] = [];
  for (const fact of validateFacts(result.value, known)) {
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

export async function askAbood(opts: {
  admin: Admin;
  userId: string;
  message: string;
  today: string;
  tz: string;
  provider: LlmProvider;
  geminiKey: string;
}): Promise<AskResult> {
  const { admin, userId, message, today, tz, provider, geminiKey } = opts;

  const [context, history, memory] = await Promise.all([
    gatherContext(admin, userId, today, tz),
    admin
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', userId)
      .eq('failed', false)
      .order('created_at', { ascending: false })
      .limit(HISTORY_TURNS),
    recall(admin, userId, message, geminiKey),
  ]);

  const priorTurns = (((history as { data: unknown }).data ?? []) as { role: string; content: string }[])
    .reverse()
    .map((m) => `${m.role === 'user' ? 'They said' : 'You answered'}: ${m.content}`)
    .join('\n');

  const input = [
    'THEIR DATA',
    context.text,
    '',
    memory.length
      ? `WHAT YOU REMEMBER ABOUT THEM (from earlier conversations; use it to be helpful, never recite it)\n${memory.map((f) => `- ${f}`).join('\n')}\n`
      : '',
    priorTurns ? `EARLIER IN THIS CONVERSATION\n${priorTurns}\n` : '',
    `THEY NOW SAY: ${message}`,
  ].join('\n');

  const result = await provider.complete<unknown>({
    instruction: CHAT_INSTRUCTION,
    input,
    schema: CHAT_SCHEMA as unknown as Record<string, unknown>,
    timeoutMs: 45_000,
  });

  if (!result.ok) return { ok: false, failure: result.failure, message: result.message };
  return { ok: true, provider: result.provider, ...validateChat(result.value, context.knownIds) };
}

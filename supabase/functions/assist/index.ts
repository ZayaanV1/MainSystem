/**
 * assist — the Phase 4 planner-side model calls.
 *
 * Two tasks behind one function: breaking an assignment into first moves, and
 * pulling deadlines out of a syllabus. They share a deploy, a quota and the
 * same contract as parse-food:
 *
 *   It returns a proposal. It does not write it.
 *
 * That is rule 6 again, and it matters more here than for food. A syllabus
 * import that silently writes fourteen rows, one of them dated by a guessed
 * year, produces a calendar that looks complete and is not — which is worse
 * than the empty one it replaced.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { geminiProvider } from '../_shared/llm/gemini.ts';
import { BREAKDOWN_INSTRUCTION, BREAKDOWN_SCHEMA, validateBreakdown } from '../_shared/breakdown.ts';
import { SYLLABUS_INSTRUCTION, SYLLABUS_SCHEMA, validateSyllabus } from '../_shared/syllabus.ts';
import { CHAT_INSTRUCTION, CHAT_SCHEMA, validateChat } from '../_shared/chat.ts';
import { buildContext } from '../_shared/context.ts';
import {
  SUMMARY_INSTRUCTION,
  SUMMARY_SCHEMA,
  fingerprint,
  isEmptyDay,
  validateSummary,
  type SummaryInput,
  type SummaryItem,
} from '../_shared/summary.ts';
import { addDays, endOfDayUTC, localDayKey, startOfDayUTC } from '../_shared/time.ts';
import { checkBudget, recordUse, standDownMessage, type AiKind } from '../_shared/budget.ts';
import { groqProvider } from '../_shared/llm/groq.ts';
import { withFallback } from '../_shared/llm/chain.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const APP_URL = env('APP_URL');

/**
 * How many model calls a day the chatbot may make before it stands down.
 *
 * The chatbot and the diet parser share one free-tier quota, and they are not
 * equally important: logging food is a thing the app exists to do, and asking
 * it a question is a convenience. So the chatbot stops first and says why,
 * rather than both hitting the wall together halfway through a meal.
 *
 * Deliberately not derived from Google's published limits. Those change, are
 * per-model, and are not visible from here — a number invented from them would
 * be a guess dressed as a policy. This is a self-imposed budget instead, and
 * running into Google's real limit is still handled as a 'quota' failure.
 */
const CHAT_CALLS_PER_DAY = Number(Deno.env.get('CHAT_CALLS_PER_DAY') ?? '40');

/** How many turns of history to send. Enough to follow a thread, bounded. */
const HISTORY_TURNS = 8;

/** A syllabus PDF. Larger than a meal photo, and they do run long. */
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_LENGTH = 8_000;

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed =
    origin === APP_URL ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/i.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);

  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : APP_URL || '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * Every failure ends with something the person can still do.
 *
 * This function and the food parser share one free-tier quota, so running out
 * is a normal Tuesday. The fallback differs by task: a breakdown can be typed
 * as subtasks, a syllabus has to be entered by hand, and saying so is more
 * use than a generic apology.
 */
const FAILURE_COPY: Record<string, string> = {
  quota: 'Out of model requests for now. Try later, or add them by hand.',
  unconfigured: 'No model is configured, so this is unavailable. Add them by hand.',
  malformed: 'The model returned something unreadable. Nothing was saved.',
  refused: 'The model declined to read that. Add them by hand.',
  unavailable: 'Could not reach the model. Try again, or add them by hand.',
  // Said without naming a setting. It used to blame GEMINI_MODEL even when
  // the model that failed was Groq's, which sent the reader to the wrong
  // provider; the detail appended below names the one that actually failed.
  retired: 'The model behind this has been withdrawn by its provider, and no replacement answered.',
};

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
async function gatherContext(admin: any, userId: string, today: string, tz: string) {
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

/** One line per item, in the shape the instruction expects. */
function describe(i: SummaryItem): string {
  const bits = [i.kind !== 'assignment' ? i.kind : '', i.due ?? 'no date',
    i.minutes ? `${i.minutes} min` : ''].filter(Boolean);
  return `  - ${i.title} (${bits.join(', ')})`;
}

/**
 * The day, in the shape the summary is written from.
 *
 * Bounded on purpose: today, the coming week, and whatever is already late.
 * A summary that reached further would be describing a month in sixty words,
 * which is how you get prose that is true and useless.
 */
// deno-lint-ignore no-explicit-any
async function gatherSummary(admin: any, userId: string, today: string, tz: string): Promise<SummaryInput> {
  const weekOut = addDays(today, 7);

  const [assignments, events, checklist, completions] = await Promise.all([
    admin
      .from('assignments')
      .select('title, due_at, effort_minutes')
      .eq('user_id', userId)
      .neq('status', 'done')
      .not('due_at', 'is', null)
      .lte('due_at', endOfDayUTC(weekOut, tz).toISOString())
      .order('due_at', { ascending: true })
      .limit(30),
    admin
      .from('events')
      .select('title, kind, starts_at')
      .eq('user_id', userId)
      .gte('starts_at', startOfDayUTC(today, tz).toISOString())
      .lte('starts_at', endOfDayUTC(weekOut, tz).toISOString())
      .order('starts_at', { ascending: true })
      .limit(15),
    admin
      .from('checklist_items')
      .select('id, title')
      .eq('user_id', userId)
      .eq('active', true),
    admin.from('checklist_completions').select('item_id').eq('user_id', userId).eq('local_day', today),
  ]);

  const dueToday: SummaryItem[] = [];
  const dueSoon: SummaryItem[] = [];
  const overdue: SummaryItem[] = [];

  // deno-lint-ignore no-explicit-any
  for (const a of (assignments.data ?? []) as any[]) {
    const day = localDayKey(new Date(a.due_at), tz);
    const item: SummaryItem = {
      title: a.title,
      due: day,
      kind: 'assignment',
      minutes: a.effort_minutes,
    };
    if (day < today) overdue.push(item);
    else if (day === today) dueToday.push(item);
    else dueSoon.push(item);
  }

  // deno-lint-ignore no-explicit-any
  for (const e of (events.data ?? []) as any[]) {
    const day = localDayKey(new Date(e.starts_at), tz);
    const item: SummaryItem = {
      title: e.title,
      due: day,
      kind: e.kind === 'exam' ? 'exam' : e.kind === 'presentation' ? 'presentation' : 'assignment',
      minutes: null,
    };
    if (day === today) dueToday.push(item);
    else if (day > today) dueSoon.push(item);
  }

  const done = new Set(((completions.data ?? []) as { item_id: string }[]).map((c) => c.item_id));
  const chores = ((checklist.data ?? []) as { id: string; title: string }[])
    .filter((c) => !done.has(c.id))
    .map((c) => c.title);

  return {
    today,
    now: new Date().toLocaleTimeString('en-CA', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }),
    dueToday,
    dueSoon,
    overdue,
    chores,
  };
}

/**
 * The budget guard the three non-chat model paths never had.
 *
 * Returns a payload rather than a Response so it carries no dependency on
 * where `json` sits in this file. `chat` keeps its own inline check because it
 * reports `remaining` to the client for the "N questions left" footer; these
 * three only need a yes or no.
 */
// deno-lint-ignore no-explicit-any
async function overBudget(admin: any, userId: string, kind: AiKind, day: string, ownKey: boolean) {
  const verdict = await checkBudget(admin, userId, kind, day, ownKey);
  if (verdict.allowed) return null;
  return { ok: false as const, failure: 'quota' as const, reason: standDownMessage(kind) };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const CORS = corsFor(req);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { 'content-type': 'application/json', ...CORS },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not authorised' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );
  if (userError || !userData?.user) return json({ error: 'not authorised' }, 401);

  let body: {
    task?: string;
    title?: string;
    notes?: string;
    courseName?: string;
    text?: string;
    pdf?: { data: string; mimeType: string };
    termFrom?: string;
    termTo?: string;
    message?: string;
    timezone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }

  /*
   * The account's own key wins over the shared one.
   *
   * Read once per request rather than per task, and never returned to the
   * client — it goes from this row straight into the provider call. RLS keeps
   * the row readable only by its owner; the service role reads it here to act
   * on that owner's behalf and nothing else.
   */
  const { data: keyRow } = await admin
    .from('app_settings')
    .select('gemini_api_key, groq_api_key, timezone')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  /*
   * A key in the wrong field is ignored rather than trusted. Google's keys
   * start "AIza", Groq's "gsk_"; a Groq key saved as the account's Gemini key
   * overrode the working shared key and made every Gemini call — food, the
   * syllabus, the briefing — fail as "API key not valid". Found on the live
   * account, where the same Groq key sat in both fields.
   */
  const rawGemini = (keyRow?.gemini_api_key as string | null)?.trim() || null;
  const ownKey = rawGemini && !rawGemini.startsWith('gsk_') ? rawGemini : null;

  /*
   * Read from the ACCOUNT, not the request body. Only the summary task ever
   * sent a timezone, so trusting the body left chat on the module default —
   * and that default is 'America/Toronto', the single-user constant this
   * project believes it removed. UTC is the honest stand-in when nobody has
   * chosen, because inventing Toronto is the bug being fixed.
   */
  const accountTz = ((keyRow?.timezone as string | null) ?? 'UTC').trim() || 'UTC';
  const provider = geminiProvider(ownKey ?? env('GEMINI_API_KEY'));

  /*
   * The chatbot may run somewhere else entirely.
   *
   * Chosen per TASK rather than globally, because the providers are not
   * interchangeable: Groq's chat models are text-only, and the diet parser
   * sends photographs of plates and of nutrition labels. A global switch would
   * quietly break photo logging the moment a Groq key was pasted — and break
   * it by answering confidently about an image that was never sent, which is
   * the exact failure the spec calls worse than no answer at all.
   *
   * So vision stays on Gemini and conversation moves to Groq when a key
   * exists. An account's own key wins over the shared one, as everywhere else.
   */
  const rawGroq = (keyRow?.groq_api_key as string | null)?.trim() || null;
  const ownGroq = rawGroq && !rawGroq.startsWith('AIza') ? rawGroq : null;
  const groqKey = ownGroq ?? env('GROQ_API_KEY');
  // Groq first when there is a key, with Gemini behind it: a Groq failure used
  // to end the question even with a working Gemini key beside it.
  const chatProvider = groqKey
    ? withFallback(groqProvider(groqKey, env('GROQ_MODEL') || undefined), provider)
    : provider;

  /*
   * The daily budget exists to stop one account draining a SHARED pool, so the
   * exemption follows whichever key actually pays for the call — the account's
   * Groq key, or its Gemini key when chat has fallen back to Gemini.
   */
  const chatOnOwnKey = Boolean(ownGroq || (!groqKey && ownKey));

  const fail = (failure: string, detail: string) =>
    json({
      ok: false,
      failure,
      /*
       * A retired model gets the DETAIL appended, not just the stock line.
       *
       * The provider computes which models the key can actually call and this
       * layer was discarding it, so the one message that could have been acted
       * on arrived as "set GEMINI_MODEL to a current model" — advice nobody
       * can follow from inside the app. The provider now recovers on its own,
       * so this only shows when recovery also failed, which is exactly when
       * the list is worth reading.
       */
      reason:
        failure === 'retired'
          ? `${FAILURE_COPY[failure]} ${detail}`
          : FAILURE_COPY[failure] ?? 'That is unavailable right now. Add them by hand.',
      detail: detail.slice(0, 300),
    });

  /* ------------------------------------------------------------ breakdown */
  if (body.task === 'breakdown') {
    const title = (body.title ?? '').trim().slice(0, 300);
    if (!title) return json({ error: 'nothing to break down' }, 400);

    const context = [
      `Assignment: ${title}`,
      body.courseName ? `Course: ${body.courseName}` : '',
      body.notes ? `Notes: ${body.notes.slice(0, 1_000)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const denied = await overBudget(admin, userData.user.id, 'breakdown', localDayKey(new Date(), accountTz), Boolean(ownKey));
    if (denied) return json(denied);

    const result = await provider.complete<unknown>({
      instruction: BREAKDOWN_INSTRUCTION,
      input: context,
      schema: BREAKDOWN_SCHEMA as unknown as Record<string, unknown>,
      // Slightly above zero: four identical-sounding steps is the failure
      // mode here, and this is the one call where a little variety helps.
      temperature: 0.4,
      timeoutMs: 40_000,
    });

    if (!result.ok) return fail(result.failure, result.message);

    // Counted only after the model was actually reached — billing a
    // refused call charges the user for hitting the wall.
    await recordUse(admin, userData.user.id, 'breakdown', localDayKey(new Date(), accountTz), Boolean(ownKey));

    const validated = validateBreakdown(result.value, title);

    // Every step can be rejected by the validator while the model still
    // reports success. Saying "nothing usable" beats an empty confirm screen.
    if (validated.steps.length === 0) {
      return json({
        ok: false,
        failure: 'malformed',
        reason: 'The steps that came back were too vague to be useful. Try again, or write your own.',
        detail: validated.warnings.join(' '),
      });
    }

    return json({ ok: true, provider: result.provider, ...validated });
  }

  /* ------------------------------------------------------------- syllabus */
  if (body.task === 'syllabus') {
    const text = (body.text ?? '').trim().slice(0, MAX_TEXT_LENGTH);
    const pdf = body.pdf;

    if (!text && !pdf) return json({ error: 'nothing to read' }, 400);

    if (pdf) {
      const approxBytes = (pdf.data.length * 3) / 4;
      if (approxBytes > MAX_PDF_BYTES) {
        return json({ ok: false, reason: 'That file is too large. Try a smaller one.' }, 413);
      }
    }

    const denied = await overBudget(admin, userData.user.id, 'syllabus', localDayKey(new Date(), accountTz), Boolean(ownKey));
    if (denied) return json(denied);

    const result = await provider.complete<unknown>({
      instruction: SYLLABUS_INSTRUCTION,
      input: text || 'Extract every graded deliverable from this syllabus.',
      images: pdf ? [{ data: pdf.data, mimeType: pdf.mimeType }] : undefined,
      schema: SYLLABUS_SCHEMA as unknown as Record<string, unknown>,
      // A syllabus is pages of PDF, not a line of text. The default would
      // abort a job that was going to succeed.
      timeoutMs: 110_000,
    });

    if (!result.ok) return fail(result.failure, result.message);

    // Counted only after the model was actually reached — billing a
    // refused call charges the user for hitting the wall.
    await recordUse(admin, userData.user.id, 'syllabus', localDayKey(new Date(), accountTz), Boolean(ownKey));

    const bounds =
      body.termFrom && body.termTo ? { from: body.termFrom, to: body.termTo } : undefined;

    const validated = validateSyllabus(result.value, bounds);

    if (validated.items.length === 0) {
      return json({
        ok: false,
        failure: 'malformed',
        reason: 'No deliverables were found in that. Check it is the right file, or add them by hand.',
        detail: validated.warnings.join(' '),
      });
    }

    return json({ ok: true, provider: result.provider, ...validated });
  }

  /* ----------------------------------------------------------------- chat */
  if (body.task === 'chat') {
    const message = (body.message ?? '').trim().slice(0, 2_000);
    if (!message) return json({ error: 'nothing to say' }, 400);

    const userId = userData.user.id;
    const today = localDayKey(new Date(), accountTz);

    // The budget check comes before the model call, so standing down costs
    // nothing. Read rather than incremented here; the increment happens only
    // if a call is actually made.
    const { data: usage } = await admin
      .from('ai_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('local_day', today)
      .eq('kind', 'chat')
      .maybeSingle();

    /*
     * The daily budget exists to stop one account draining a shared free tier
     * before anyone else can log a meal. An account paying its own way is not
     * competing with anybody, so the reserve simply does not apply to it.
     */
    if (!chatOnOwnKey && (usage?.count ?? 0) >= CHAT_CALLS_PER_DAY) {
      return json({
        ok: false,
        failure: 'quota',
        reason:
          'That is enough questions for today — the rest of the daily model budget is kept for logging food. It resets tomorrow.',
      });
    }

    const context = await gatherContext(admin, userId, today, accountTz);

    const { data: history } = await admin
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_TURNS);

    const priorTurns = ((history ?? []) as { role: string; content: string }[])
      .reverse()
      .map((m) => `${m.role === 'user' ? 'They asked' : 'You answered'}: ${m.content}`)
      .join('\n');

    const input = [
      'THEIR DATA',
      context.text,
      '',
      priorTurns ? `EARLIER IN THIS CONVERSATION\n${priorTurns}\n` : '',
      `THEY NOW ASK: ${message}`,
    ].join('\n');

    const result = await chatProvider.complete<unknown>({
      instruction: CHAT_INSTRUCTION,
      input,
      schema: CHAT_SCHEMA as unknown as Record<string, unknown>,
      timeoutMs: 45_000,
    });

    // Counted after the call is made rather than before, so a failed request
    // does not spend budget the user never got an answer from.
    await admin.rpc('record_ai_use', { p_user_id: userId, p_local_day: today, p_kind: 'chat' });

    if (!result.ok) return fail(result.failure, result.message);

    const validated = validateChat(result.value, context.knownIds);

    return json({
      ok: true,
      provider: result.provider,
      ...validated,
      remaining: Math.max(0, CHAT_CALLS_PER_DAY - ((usage?.count ?? 0) + 1)),
    });
  }

  /* -------------------------------------------------------------- summary */
  if (body.task === 'summary') {
    const userId = userData.user.id;
    const tz = (body.timezone ?? accountTz).trim();
    const today = localDayKey(new Date(), tz);

    const input = await gatherSummary(admin, userId, today, tz);

    // Nothing to say beats saying nothing well. This also means an empty day
    // never costs a model call, which matters most for a new account.
    if (isEmptyDay(input)) {
      return json({ ok: true, summary: '', empty: true });
    }

    const print = fingerprint(input);

    const { data: cached } = await admin
      .from('daily_summaries')
      .select('body, fingerprint')
      .eq('user_id', userId)
      .eq('local_day', today)
      .maybeSingle();

    // The whole reason the table exists: the app opens many times a day and
    // the answer only changes when the work does.
    if (cached?.fingerprint === print && cached.body) {
      return json({ ok: true, summary: cached.body, cached: true });
    }

    const lines = [
      `Local date: ${input.today}. Local time now: ${input.now}.`,
      '',
      'DUE TODAY',
      input.dueToday.length ? input.dueToday.map(describe).join('\n') : '  (nothing)',
      '',
      'DUE IN THE NEXT WEEK',
      input.dueSoon.length ? input.dueSoon.map(describe).join('\n') : '  (nothing)',
      '',
      'ALREADY PAST ITS DATE',
      input.overdue.length ? input.overdue.map(describe).join('\n') : '  (nothing)',
      '',
      'STILL TO DO TODAY, RECURRING',
      input.chores.length ? input.chores.map((c) => `  - ${c}`).join('\n') : '  (nothing)',
    ].join('\n');

    const denied = await overBudget(admin, userData.user.id, 'summary', localDayKey(new Date(), accountTz), Boolean(ownKey));
    if (denied) return json(denied);

    const result = await provider.complete<unknown>({
      instruction: SUMMARY_INSTRUCTION,
      input: lines,
      schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
      // A little warmth, so the closing suggestion is not the same sentence
      // every morning.
      temperature: 0.6,
      timeoutMs: 30_000,
    });

    if (!result.ok) {
      // A stale summary beats none: it was true this morning, and the screen
      // underneath is authoritative either way.
      if (cached?.body) return json({ ok: true, summary: cached.body, stale: true });
      return fail(result.failure, result.message);
    }

    // Counted only after the model was actually reached — billing a
    // refused call charges the user for hitting the wall.
    await recordUse(admin, userData.user.id, 'summary', localDayKey(new Date(), accountTz), Boolean(ownKey));

    const validated = validateSummary(result.value, input);

    if (!validated.summary) {
      if (cached?.body) return json({ ok: true, summary: cached.body, stale: true });
      return json({ ok: true, summary: '', dropped: validated.warnings });
    }

    await admin.from('daily_summaries').upsert(
      { user_id: userId, local_day: today, body: validated.summary, fingerprint: print },
      { onConflict: 'user_id,local_day' },
    );

    return json({ ok: true, summary: validated.summary });
  }

  return json({ error: `unknown task: ${body.task ?? '(none)'}` }, 400);
});

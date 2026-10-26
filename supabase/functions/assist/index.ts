/**
 * assist — the Phase 4 planner-side model calls.
 *
 * Two tasks behind one function: breaking an assignment into first moves, and
 * pulling deadlines out of a syllabus. They share a deploy, a quota and one
 * contract:
 *
 *   It returns a proposal. It does not write it.
 *
 * That is rule 6, and it matters most for the syllabus. A syllabus
 * import that silently writes fourteen rows, one of them dated by a guessed
 * year, produces a calendar that looks complete and is not — which is worse
 * than the empty one it replaced.
 */

import { corsFor } from '../_shared/cors.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { geminiProvider } from '../_shared/llm/gemini.ts';
import { BREAKDOWN_INSTRUCTION, BREAKDOWN_SCHEMA, validateBreakdown } from '../_shared/breakdown.ts';
import { GUIDE_INSTRUCTION, GUIDE_SCHEMA, validateGuide } from '../_shared/guide.ts';
import { SYLLABUS_INSTRUCTION, SYLLABUS_SCHEMA, validateSyllabus } from '../_shared/syllabus.ts';
import { askAbood, learn } from '../_shared/abood.ts';
import {
  SUMMARY_INSTRUCTION,
  SUMMARY_SCHEMA,
  fingerprint,
  isEmptyDay,
  validateSummary,
  type SummaryInput,
  type SummaryItem,
  type SummaryClass,
  DUE_EVENT_KINDS,
} from '../_shared/summary.ts';
import { addDays, endOfDayUTC, localDayKey, localHourMinute, startOfDayUTC } from '../_shared/time.ts';
import { readBody } from '../_shared/body.ts';
import { meterFor, release, reserve, standDownMessage, type AiKind, type Reservation } from '../_shared/budget.ts';
import { groqProvider } from '../_shared/llm/groq.ts';
import { withFallback } from '../_shared/llm/chain.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const APP_URL = env('APP_URL');

/** A syllabus PDF. They do run long. */
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_LENGTH = 8_000;
/** The PDF as base64 plus the JSON around it. Anything bigger is refused unread. */
const MAX_REQUEST_BYTES = Math.ceil((MAX_PDF_BYTES * 4) / 3) + 64 * 1024;

/**
 * Every failure ends with something the person can still do.
 *
 * Every path in this function shares one free-tier quota, so running out
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

  const [assignments, dueEvents, classEvents, checklist, completions] = await Promise.all([
    admin
      .from('assignments')
      .select('title, due_at, effort_minutes')
      .eq('user_id', userId)
      .neq('status', 'done')
      .not('due_at', 'is', null)
      .lte('due_at', endOfDayUTC(weekOut, tz).toISOString())
      .order('due_at', { ascending: true })
      .limit(30),
    // Exams and presentations on their own, so a week of synced lectures can
    // never crowd one out of the list.
    admin
      .from('events')
      .select('title, kind, starts_at')
      .eq('user_id', userId)
      .in('kind', [...DUE_EVENT_KINDS])
      .gte('starts_at', startOfDayUTC(today, tz).toISOString())
      .lte('starts_at', endOfDayUTC(weekOut, tz).toISOString())
      .order('starts_at', { ascending: true })
      .limit(20),
    // Today's timetable: attended, not due.
    admin
      .from('events')
      .select('title, kind, starts_at, all_day')
      .eq('user_id', userId)
      .not('kind', 'in', `(${DUE_EVENT_KINDS.join(',')})`)
      .eq('all_day', false)
      .gte('starts_at', startOfDayUTC(today, tz).toISOString())
      .lte('starts_at', endOfDayUTC(today, tz).toISOString())
      .order('starts_at', { ascending: true })
      .limit(12),
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
  for (const e of (dueEvents.data ?? []) as any[]) {
    const day = localDayKey(new Date(e.starts_at), tz);
    const item: SummaryItem = {
      title: e.title,
      due: day,
      kind: e.kind === 'exam' ? 'exam' : 'presentation',
      minutes: null,
    };
    if (day === today) dueToday.push(item);
    else if (day > today) dueSoon.push(item);
  }

  // deno-lint-ignore no-explicit-any
  const classes: SummaryClass[] = ((classEvents.data ?? []) as any[]).map((e) => {
    const { hour, minute } = localHourMinute(new Date(e.starts_at), tz);
    return { title: e.title, at: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
  });

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
    classes,
    chores,
  };
}

/**
 * What a refused reservation is told. A payload rather than a Response so it
 * carries no dependency on where `json` sits in this file.
 */
function standDown(slot: Reservation, kind: AiKind) {
  return { ok: false as const, failure: 'quota' as const, reason: standDownMessage(kind, slot.denied) };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const CORS = corsFor(req, APP_URL);

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

  const read = await readBody(
    req,
    {
      task: { type: 'string', max: 40 },
      title: { type: 'string', max: 5_000 },
      notes: { type: 'string', max: 50_000 },
      courseName: { type: 'string', max: 500 },
      text: { type: 'string', max: 200_000 },
      // Base64 of MAX_PDF_BYTES, with a little room for the encoding's padding.
      pdf: { type: 'file', maxChars: Math.ceil((MAX_PDF_BYTES * 4) / 3) + 16 },
      termFrom: { type: 'string', max: 20 },
      termTo: { type: 'string', max: 20 },
      message: { type: 'string', max: 50_000 },
      timezone: { type: 'string', max: 100 },
      fileId: { type: 'string', max: 100 },
    },
    MAX_REQUEST_BYTES,
  );
  if (!read.ok) return json({ error: read.error }, read.status);
  const body = read.body;

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
   * overrode the working shared key and made every Gemini call — the
   * syllabus, the briefing, chat's fallback — fail as "API key not valid". Found on the live
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
   * interchangeable: Groq's chat models are text-only, and the syllabus reader
   * sends PDFs. A global switch would quietly break PDF import the moment a
   * Groq key was pasted.
   *
   * So documents stay on Gemini and conversation moves to Groq when a key
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

    const slot = await reserve(admin, userData.user.id, 'breakdown', localDayKey(new Date(), accountTz), Boolean(ownKey));
    if (!slot.allowed) return json(standDown(slot, 'breakdown'));

    const result = await provider.complete<unknown>({
      instruction: BREAKDOWN_INSTRUCTION,
      input: context,
      schema: BREAKDOWN_SCHEMA as unknown as Record<string, unknown>,
      // Slightly above zero: four identical-sounding steps is the failure
      // mode here, and this is the one call where a little variety helps.
      temperature: 0.4,
      timeoutMs: 40_000,
    });

    // A slot was reserved; a call that produced nothing gives it back, so
    // hitting a wall never costs the user a question.
    if (!result.ok) {
      await release(admin, userData.user.id, 'breakdown', localDayKey(new Date(), accountTz), slot);
      return fail(result.failure, result.message);
    }

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

    const slot = await reserve(admin, userData.user.id, 'syllabus', localDayKey(new Date(), accountTz), Boolean(ownKey));
    if (!slot.allowed) return json(standDown(slot, 'syllabus'));

    const result = await provider.complete<unknown>({
      instruction: SYLLABUS_INSTRUCTION,
      input: text || 'Extract every graded deliverable from this syllabus.',
      images: pdf ? [{ data: pdf.data, mimeType: pdf.mimeType }] : undefined,
      schema: SYLLABUS_SCHEMA as unknown as Record<string, unknown>,
      // A syllabus is pages of PDF, not a line of text. The default would
      // abort a job that was going to succeed.
      timeoutMs: 110_000,
    });

    if (!result.ok) {
      await release(admin, userData.user.id, 'syllabus', localDayKey(new Date(), accountTz), slot);
      return fail(result.failure, result.message);
    }

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

  /* ---------------------------------------------------------------- guide */
  if (body.task === 'guide') {
    const userId = userData.user.id;
    const fileId = (body.fileId ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) return json({ error: 'no file named' }, 400);

    // The row is read as the service role but scoped to the caller, so a file
    // id belonging to someone else finds nothing rather than a stranger's PDF.
    const { data: file } = await admin
      .from('assignment_files')
      .select('id, path, size_bytes, assignment_id')
      .eq('id', fileId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!file) return json({ ok: false, reason: 'That file is no longer there.' }, 404);
    if ((file.size_bytes as number) > MAX_PDF_BYTES) {
      return json({ ok: false, reason: 'That file is too large to read. Try a smaller one.' }, 413);
    }

    const { data: work } = await admin
      .from('assignments')
      .select('title, notes, courses(name, code)')
      .eq('id', file.assignment_id)
      .eq('user_id', userId)
      .maybeSingle();

    const slot = await reserve(admin, userId, 'guide', localDayKey(new Date(), accountTz), Boolean(ownKey));
    if (!slot.allowed) return json(standDown(slot, 'guide'));

    const blob = await admin.storage.from('work-files').download(file.path as string);
    if (blob.error || !blob.data) {
      await release(admin, userId, 'guide', localDayKey(new Date(), accountTz), slot);
      return json({ ok: false, reason: 'Could not open that file. Try again in a moment.' }, 502);
    }
    const bytes = new Uint8Array(await blob.data.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }

    // deno-lint-ignore no-explicit-any
    const course = (work as any)?.courses as { name?: string; code?: string } | null;
    const context = [
      `Assignment: ${work?.title ?? 'Untitled'}`,
      course?.code || course?.name ? `Course: ${course.code ?? course.name}` : '',
      work?.notes ? `The student's own notes: ${String(work.notes).slice(0, 800)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await provider.complete<unknown>({
      instruction: GUIDE_INSTRUCTION,
      input: context,
      images: [{ data: btoa(binary), mimeType: 'application/pdf' }],
      schema: GUIDE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.3,
      timeoutMs: 110_000,
    });

    if (!result.ok) {
      await release(admin, userId, 'guide', localDayKey(new Date(), accountTz), slot);
      return fail(result.failure, result.message);
    }

    const validated = validateGuide(result.value);
    if (validated.guide.parts.length === 0 && validated.guide.requirements.length === 0) {
      return json({
        ok: false,
        failure: 'malformed',
        reason: validated.guide.overview
          ? validated.guide.overview
          : 'No assignment could be read from that file. Check it is the brief, or write the plan by hand.',
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

    // A slot is taken before the model is called, in one step, so requests
    // sent together cannot all be handed the last one. Standing down costs
    // nothing, and a call that produces nothing gives its slot back.
    const slot = await reserve(admin, userId, 'chat', today, chatOnOwnKey);
    if (!slot.allowed) {
      return json({
        ok: false,
        failure: 'quota',
        reason:
          slot.denied === 'shared'
            ? standDownMessage('chat', 'shared')
            : 'That is enough questions for today. It resets tomorrow, and everything else works as usual.',
      });
    }

    const gemini = ownKey ?? env('GEMINI_API_KEY');
    // Looking a memory up and filing a new one each cost an embedding call on
    // the same key, so they are counted too.
    const embedMeter = meterFor(admin, userId, 'embed', today, Boolean(ownKey));
    let result: Awaited<ReturnType<typeof askAbood>>;
    try {
      result = await askAbood({
        admin,
        userId,
        message,
        today,
        tz: accountTz,
        provider: chatProvider,
        geminiKey: gemini,
        embedMeter,
      });
    } catch (e) {
      await release(admin, userId, 'chat', today, slot);
      throw e;
    }

    if (!result.ok) {
      await release(admin, userId, 'chat', today, slot);
      return fail(result.failure, result.message);
    }

    // Learn from what they said, after answering it. A memory failure never
    // costs the answer.
    const learned = await learn(admin, userId, result.remember, gemini, 'app', embedMeter).catch(() => []);
    const { ok: _ok, provider: _p, remember: _r, needsPlanner: _n, ...validated } = result;

    return json({
      ok: true,
      provider: result.provider,
      ...validated,
      learned,
      remaining: Number.isFinite(slot.remaining) ? slot.remaining : slot.limit,
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
      'ON THE TIMETABLE TODAY (classes to attend, not work to hand in)',
      input.classes.length ? input.classes.map((c) => `  - ${c.at} ${c.title}`).join('\n') : '  (nothing)',
      '',
      'STILL TO DO TODAY, RECURRING',
      input.chores.length ? input.chores.map((c) => `  - ${c}`).join('\n') : '  (nothing)',
    ].join('\n');

    const slot = await reserve(admin, userData.user.id, 'summary', localDayKey(new Date(), accountTz), Boolean(ownKey));
    // Over today's cap, the last briefing beats no briefing: it was true when
    // written and the screen below it is current either way.
    if (!slot.allowed) return cached?.body ? json({ ok: true, summary: cached.body, stale: true }) : json(standDown(slot, 'summary'));

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
      await release(admin, userData.user.id, 'summary', localDayKey(new Date(), accountTz), slot);
      // A stale summary beats none: it was true this morning, and the screen
      // underneath is authoritative either way.
      if (cached?.body) return json({ ok: true, summary: cached.body, stale: true });
      return fail(result.failure, result.message);
    }

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

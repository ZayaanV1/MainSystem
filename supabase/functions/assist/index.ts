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

const env = (k: string): string => Deno.env.get(k) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const APP_URL = env('APP_URL');

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
  retired: 'The configured model is no longer available. This needs GEMINI_MODEL set to a current model.',
};

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
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }

  const provider = geminiProvider(env('GEMINI_API_KEY'));

  const fail = (failure: string, detail: string) =>
    json({
      ok: false,
      failure,
      reason: FAILURE_COPY[failure] ?? 'That is unavailable right now. Add them by hand.',
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

  return json({ error: `unknown task: ${body.task ?? '(none)'}` }, 400);
});

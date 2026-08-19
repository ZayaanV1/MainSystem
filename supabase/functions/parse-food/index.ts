/**
 * parse-food — turns a description or a photo of a meal into structured items.
 *
 * It returns the parse. It does not write it.
 *
 * That is rule 6, and it is the whole design: "AI-parsed food, AI-extracted
 * syllabus dates, and chatbot actions are all shown for confirmation before
 * they touch the database." An estimate that silently lands in the log is
 * worse than no parser at all, because you stop being able to tell which
 * numbers you chose and which a model guessed.
 *
 * Authenticated with the user's JWT. There is no cron path here: nothing about
 * parsing food happens on a schedule.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { geminiProvider } from '../_shared/llm/gemini.ts';
import { FOOD_INSTRUCTION, FOOD_SCHEMA, validateParse } from '../_shared/food.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const APP_URL = env('APP_URL');

/** Enough for a phone photo; beyond this the model gains nothing. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 2_000;

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
 * What the app should say when the model cannot answer.
 *
 * Every one of these ends with something the person can still do. The diet
 * parser and the chatbot share one free-tier quota, so running out is a normal
 * Tuesday, not an exception — and the answer to it is always "type it in",
 * which has to be said rather than implied.
 */
const FAILURE_COPY: Record<string, string> = {
  quota: 'The food parser is out of requests for now. Add the items by hand, or try later.',
  unconfigured: 'No model is configured, so parsing is unavailable. Add the items by hand.',
  malformed: 'The model returned something unreadable. Nothing was saved. Add the items by hand.',
  refused: 'The model declined to read that. Add the items by hand.',
  unavailable: 'Could not reach the model. Add the items by hand, or try again.',
  // Retrying is useless here, so it is not offered. This one needs a setting
  // changed, and `detail` carries the model names the key can actually use.
  retired: 'The configured model is no longer available. Add the items by hand; this needs GEMINI_MODEL set to a current model.',
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

  let body: { text?: string; image?: { data: string; mimeType: string } };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'expected JSON' }, 400);
  }

  const text = (body.text ?? '').trim().slice(0, MAX_TEXT_LENGTH);
  const image = body.image;

  if (!text && !image) return json({ error: 'nothing to parse' }, 400);

  if (image) {
    // base64 is about 4/3 the size of the bytes it encodes.
    const approxBytes = (image.data.length * 3) / 4;
    if (approxBytes > MAX_IMAGE_BYTES) {
      return json({ ok: false, reason: 'That photo is too large. Try a smaller one.' }, 413);
    }
  }

  // Same rule as the assist function: the account's own key wins. Food
  // logging is the path that must not fail, so it gets the same treatment.
  const { data: keyRow } = await admin
    .from('app_settings')
    .select('gemini_api_key')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  const ownKey = (keyRow?.gemini_api_key as string | null)?.trim() || null;
  const provider = geminiProvider(ownKey ?? env('GEMINI_API_KEY'));

  const result = await provider.complete<unknown>({
    instruction: FOOD_INSTRUCTION,
    input: text || 'Identify the food in this photo and estimate its nutrition.',
    images: image ? [{ data: image.data, mimeType: image.mimeType }] : undefined,
    schema: FOOD_SCHEMA as unknown as Record<string, unknown>,
  });

  if (!result.ok) {
    return json({
      ok: false,
      failure: result.failure,
      reason: FAILURE_COPY[result.failure] ?? 'Parsing is unavailable. Add the items by hand.',
      // Kept for the delivery-log-style diagnosis this project relies on.
      detail: result.message.slice(0, 300),
    });
  }

  // Validated a second time on our side. The provider guarantees shape; this
  // guarantees sense, and nothing has been written yet either way.
  const parsed = validateParse(result.value);

  return json({
    ok: true,
    provider: result.provider,
    items: parsed.items,
    warnings: parsed.warnings,
    raw_text: text || null,
  });
});

/**
 * calendar — the subscribable .ics feed.
 *
 * The only endpoint in this app that serves data without a login, because a
 * calendar app cannot present one. The token in the query string is therefore
 * the whole credential, and the consequences are handled rather than assumed:
 *
 *   Lookup is by token alone, and a miss returns 404 with no detail. Saying
 *   "no such token" and "wrong token for this user" differently would turn the
 *   endpoint into an oracle.
 *
 *   Only titles and times are published. Notes never go in, because a URL that
 *   can be forwarded, logged by a proxy or synced to someone's work laptop
 *   should carry as little as it can.
 *
 *   Nothing here is writable. GET only, no side effects, no usage counted.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { buildIcs, type IcsEvent } from '../_shared/ics.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

/** How far back to publish. Enough to see the term, not the archive. */
const LOOKBACK_DAYS = 60;
const LOOKAHEAD_DAYS = 240;

/**
 * A feed is fetched by a calendar app server-side, so CORS is not needed for
 * the real subscription path. It is answered anyway: an endpoint that 405s a
 * preflight is a foot-gun for any later in-app preview, and three lines is
 * cheaper than rediscovering why the fetch fails.
 *
 * The feed is already public to anyone holding the token, so a permissive
 * origin here gives away nothing the URL does not.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};

/**
 * A brake on token guessing, and an honest account of what it is worth.
 *
 * The token is 32 random bytes, so brute force is not the threat — the threat
 * is that every wrong guess of the right LENGTH costs a database round trip
 * on a free tier, and an attacker can spend that budget for nothing.
 *
 * This is per-instance memory, which means it is a speed bump rather than a
 * wall: edge instances are ephemeral and there may be several. It still blunts
 * a sustained scan from one source, costs no storage, and adds no write to a
 * read-only endpoint. A durable counter would mean a write per request, which
 * spends the resource it is trying to protect.
 *
 * Only FAILURES are counted. A calendar client polling a valid feed every
 * fifteen minutes must never be throttled.
 */
const MISSES = new Map<string, { n: number; until: number }>();
const MISS_WINDOW_MS = 60_000;
const MISS_LIMIT = 20;

function tooManyMisses(ip: string): boolean {
  const now = Date.now();
  const seen = MISSES.get(ip);
  if (!seen || now > seen.until) return false;
  return seen.n >= MISS_LIMIT;
}

function noteMiss(ip: string): void {
  const now = Date.now();
  const seen = MISSES.get(ip);
  if (!seen || now > seen.until) MISSES.set(ip, { n: 1, until: now + MISS_WINDOW_MS });
  else seen.n += 1;

  // Bounded, so a spray of forged IPs cannot grow this without limit.
  if (MISSES.size > 5_000) {
    for (const [k, v] of MISSES) if (now > v.until) MISSES.delete(k);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('GET only', { status: 405, headers: CORS });
  }

  const token = new URL(req.url).searchParams.get('token') ?? '';

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown';

  /*
   * Deliberately the SAME bare 404 as a wrong token. A distinct 429 would tell
   * a scanner that it had found the rate limiter, which is one more bit than
   * this endpoint should ever give away — the whole design of the miss path is
   * that it is not an oracle.
   */
  if (tooManyMisses(ip)) return new Response('Not found', { status: 404, headers: CORS });

  // A short token is not a real one; rejected before touching the database.
  if (token.length < 20) {
    noteMiss(ip);
    return new Response('Not found', { status: 404, headers: CORS });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: settings } = await admin
    .from('app_settings')
    .select('user_id, timezone')
    .eq('ics_token', token)
    .maybeSingle();

  // Deliberately identical to the short-token response.
  if (!settings) {
    noteMiss(ip);
    return new Response('Not found', { status: 404, headers: CORS });
  }

  const userId = settings.user_id as string;
  const timezone = (settings.timezone as string) ?? 'America/Toronto';

  const from = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const to = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString();

  const [assignments, events] = await Promise.all([
    admin
      .from('assignments')
      .select('id, title, due_at, due_has_time, status, courses(code, name)')
      .eq('user_id', userId)
      .not('due_at', 'is', null)
      .gte('due_at', from)
      .lte('due_at', to),
    admin
      .from('events')
      .select('id, title, kind, starts_at, ends_at, all_day, courses(code, name)')
      .eq('user_id', userId)
      .gte('starts_at', from)
      .lte('starts_at', to),
  ]);

  // deno-lint-ignore no-explicit-any
  const courseOf = (r: any) => r.courses?.code ?? r.courses?.name ?? null;

  const ics: IcsEvent[] = [];

  // deno-lint-ignore no-explicit-any
  for (const a of (assignments.data ?? []) as any[]) {
    const course = courseOf(a);
    ics.push({
      // Stable and namespaced, so a client updates an event rather than
      // creating a duplicate every time it refreshes.
      uid: `assignment-${a.id}@life-planner`,
      start: new Date(a.due_at),
      end: null,
      // An assignment with no stated time is a whole day, not midnight.
      allDay: !a.due_has_time,
      summary: [
        a.status === 'done' ? '✓' : '',
        course ? `${course}:` : '',
        a.title,
      ].filter(Boolean).join(' '),
      description: null,
    });
  }

  // deno-lint-ignore no-explicit-any
  for (const e of (events.data ?? []) as any[]) {
    const course = courseOf(e);
    ics.push({
      uid: `event-${e.id}@life-planner`,
      start: new Date(e.starts_at),
      end: e.ends_at ? new Date(e.ends_at) : null,
      allDay: Boolean(e.all_day),
      summary: [course ? `${course}:` : '', e.title].filter(Boolean).join(' '),
      description: null,
    });
  }

  const body = buildIcs(ics, { name: 'Planner', timezone });

  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      ...CORS,
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="planner.ics"',
      /*
       * `private`, not `public`. This body is one account's deadlines,
       * authorised solely by a token in the query string. A `public` directive
       * invites any shared cache to store it — harmless today, because
       * Supabase functions sit behind no query-normalising CDN, and a
       * cross-user leak the day one is introduced. The word costs nothing and
       * the failure mode is silent.
       */
      'cache-control': 'private, max-age=900',
    },
  });
});

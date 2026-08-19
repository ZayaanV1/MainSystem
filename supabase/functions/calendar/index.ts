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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('GET only', { status: 405, headers: CORS });
  }

  const token = new URL(req.url).searchParams.get('token') ?? '';

  // A short token is not a real one; rejected before touching the database.
  if (token.length < 20) return new Response('Not found', { status: 404, headers: CORS });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: settings } = await admin
    .from('app_settings')
    .select('user_id, timezone')
    .eq('ics_token', token)
    .maybeSingle();

  // Deliberately identical to the short-token response.
  if (!settings) return new Response('Not found', { status: 404, headers: CORS });

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
      // Clients poll often; a short cache spares the function without making
      // a new deadline take long to appear.
      'cache-control': 'public, max-age=900',
    },
  });
});

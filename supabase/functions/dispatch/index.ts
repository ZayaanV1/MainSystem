/**
 * dispatch — the scheduled entry point.
 *
 * Invoked two ways:
 *
 *   1. By pg_cron, every 15 minutes, carrying a shared secret header. It walks
 *      every user, asks whether it is currently their digest time, and sends
 *      to those for whom it is. The schedule is deliberately dumb and frequent;
 *      `decideDigest` and a unique index do the thinking.
 *
 *   2. By the app, carrying the user's JWT, to send a test notification. This
 *      is the "send test digest now" button, and it is the fastest way to tell
 *      whether the pipeline is alive without waiting until tomorrow morning.
 *
 * Running every 15 minutes also keeps the Supabase project off the free tier's
 * 7-day inactivity pause. That is not incidental — a project that pauses
 * during a bad week takes the digest down exactly when it is most needed.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

import { deliver } from '../_shared/deliver.ts';
import { buildDigest, renderTestMessage, type DigestSettings } from '../_shared/digest.ts';
import { decideDigest } from '../_shared/schedule.ts';
import { localDayKey, minutesSinceLocal } from '../_shared/time.ts';
import {
  dueForEscalation,
  escalationKey,
  renderEscalation,
  type EscalatableEvent,
} from '../_shared/escalation.ts';
import type { VapidKeys } from '../_shared/channels/webpush.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const CRON_SECRET = env('CRON_SECRET');
const APP_URL = env('APP_URL');

const VAPID: VapidKeys = {
  publicKey: env('VAPID_PUBLIC_KEY'),
  privateKey: env('VAPID_PRIVATE_KEY'),
  subject: env('VAPID_SUBJECT') || 'mailto:noreply@example.com',
};

/**
 * When an exam the next day gets its own notification.
 *
 * 20:00 local, because the night before is the last moment preparation is
 * still possible — the morning of is information you already have and can do
 * nothing with. A fixed hour rather than a setting, for now: one more dial on
 * the settings screen costs more than it earns until there is evidence this
 * one is wrong.
 */
const ESCALATION_HOUR = 20;

/** Same catch-up tolerance as the digest, for the same reason. */
const ESCALATION_WINDOW_MINUTES = 180;

/**
 * CORS.
 *
 * This was previously pinned to APP_URL alone, which fails badly: deploy to a
 * new URL, or open a Vercel preview build, and every request dies with Safari's
 * opaque "Load failed" — no clue that the cause is a stale environment
 * variable. That is precisely the kind of silent, undiagnosable breakage this
 * project is supposed to avoid.
 *
 * CORS is not the security boundary here in any case. Every path is gated on
 * either a user JWT or the cron secret, and the browser sends a bearer token
 * rather than a cookie, so no request is authorised merely by its origin.
 */
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';

  const allowed =
    origin === APP_URL ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/i.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);

  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : APP_URL || '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

interface SettingsRow extends DigestSettings {
  user_id: string;
  digest_hour: number;
  digest_minute: number;
  digest_enabled: boolean;
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

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'function is missing its Supabase environment' }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const deps = {
    db: admin,
    telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
    vapid: VAPID,
  };

  const now = new Date();

  // ---- Path 1: scheduled run -------------------------------------------
  // Compared with a constant-time check so the secret cannot be recovered by
  // timing the endpoint, which is public by construction.
  const presented = req.headers.get('x-cron-secret') ?? '';
  if (CRON_SECRET && timingSafeEqual(presented, CRON_SECRET)) {
    const { data, error } = await admin
      .from('app_settings')
      .select('user_id, timezone, digest_hour, digest_minute, digest_enabled, assignment_window_days, event_window_days');

    if (error) return json({ error: error.message }, 500);

    const results = [];

    for (const settings of (data ?? []) as SettingsRow[]) {
      const localDay = localDayKey(now, settings.timezone);

      const { count } = await admin
        .from('delivery_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', settings.user_id)
        .eq('kind', 'digest')
        .eq('local_day', localDay)
        .eq('status', 'sent');

      const decision = decideDigest(settings, now, (count ?? 0) > 0);

      if (!decision.send) {
        results.push({ user: settings.user_id, sent: false, reason: decision.reason });
        continue;
      }

      const msg = await buildDigest(admin, settings.user_id, settings, decision.localDay, APP_URL);
      const outcome = await deliver(deps, settings.user_id, 'digest', decision.localDay, msg);

      results.push({
        user: settings.user_id,
        sent: outcome.delivered,
        channel: outcome.channel,
        minutesLate: decision.minutesLate,
        errors: outcome.errors,
      });
    }

    // Escalations run independently of the digest: a different hour, a
    // different idempotency key, and no reason for one to block the other.
    for (const settings of (data ?? []) as SettingsRow[]) {
      const escalated = await runEscalations(admin, deps, settings, now);
      if (escalated.length) results.push({ user: settings.user_id, escalations: escalated });
    }

    return json({ ran: 'scheduled', at: now.toISOString(), results });
  }

  // ---- Path 2: user-triggered test -------------------------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'not authorised' }, 401);
  }

  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );

  if (userError || !userData?.user) return json({ error: 'not authorised' }, 401);

  const userId = userData.user.id;

  const { data: settings } = await admin
    .from('app_settings')
    .select('timezone, assignment_window_days, event_window_days')
    .eq('user_id', userId)
    .single();

  const timezone = settings?.timezone ?? 'America/Toronto';
  const localDay = localDayKey(now, timezone);

  const msg = renderTestMessage(localDay, timezone, APP_URL);
  const outcome = await deliver(deps, userId, 'test', localDay, msg);

  return json(
    {
      ran: 'test',
      delivered: outcome.delivered,
      channel: outcome.channel,
      errors: outcome.errors,
    },
    outcome.delivered ? 200 : 502,
  );
});

/** Length-independent comparison, so the endpoint leaks nothing by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Sends tomorrow's exams and presentations, once each.
 *
 * Returns what it sent, so a scheduled run reports escalations the same way it
 * reports the digest — a notification nobody can see the record of is one you
 * cannot debug when it fails to arrive.
 */
async function runEscalations(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  deps: any,
  settings: SettingsRow,
  now: Date,
): Promise<string[]> {
  const elapsed = minutesSinceLocal(ESCALATION_HOUR, 0, now, settings.timezone);
  if (elapsed < 0 || elapsed > ESCALATION_WINDOW_MINUTES) return [];

  const localDay = localDayKey(now, settings.timezone);

  const { data: events } = await admin
    .from('events')
    .select('id, title, kind, starts_at, all_day, location')
    .eq('user_id', settings.user_id);

  const due = dueForEscalation((events ?? []) as EscalatableEvent[], localDay, settings.timezone);
  if (due.length === 0) return [];

  const sent: string[] = [];

  for (const event of due) {
    const key = escalationKey(event, localDay);

    const { count } = await admin
      .from('delivery_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', settings.user_id)
      .eq('kind', 'escalation')
      .eq('dedupe_key', key)
      .eq('status', 'sent');

    if ((count ?? 0) > 0) continue;

    const msg = renderEscalation([event], localDay, settings.timezone, APP_URL);
    const outcome = await deliver(deps, settings.user_id, 'escalation', localDay, msg, key);

    if (outcome.delivered) sent.push(event.title);
  }

  return sent;
}

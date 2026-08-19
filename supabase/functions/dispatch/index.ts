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
import { buildWeekly, decideWeekly } from '../_shared/weekly.ts';
import { addDays, endOfDayUTC, localDayKey, minutesSinceLocal, startOfDayUTC } from '../_shared/time.ts';
import {
  dueForEscalation,
  escalationKey,
  renderEscalation,
  type EscalatableEvent,
} from '../_shared/escalation.ts';
import {
  assignmentReminderKey,
  assignmentRemindersDue,
  checklistReminderKey,
  checklistRemindersDue,
  renderReminder,
  type RemindableAssignment,
  type RemindableItem,
} from '../_shared/reminders.ts';
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
  /** Off unless asked for; the weekly review shares the digest's send time. */
  weekly_review_enabled: boolean;
  weekly_review_weekday: number;
}

/**
 * The rows behind a weekly review.
 *
 * Deliberately narrow. This runs unattended for every user on a fifteen-minute
 * cron, so it fetches four small windows rather than anything open-ended.
 */
// deno-lint-ignore no-explicit-any
async function gatherWeekly(admin: any, userId: string, today: string) {
  const weekAgo = addDays(today, -7);
  const weekAhead = addDays(today, 7);

  const [finished, upcoming, overdue, deferralRows, openWork] = await Promise.all([
    admin
      .from('assignments')
      .select('title')
      .eq('user_id', userId)
      .eq('status', 'done')
      .gte('completed_at', startOfDayUTC(weekAgo).toISOString())
      .lte('completed_at', endOfDayUTC(today).toISOString())
      .limit(20),
    admin
      .from('assignments')
      .select('title, due_at, effort_minutes')
      .eq('user_id', userId)
      .neq('status', 'done')
      .gt('due_at', endOfDayUTC(today).toISOString())
      .lte('due_at', endOfDayUTC(weekAhead).toISOString())
      .limit(40),
    admin
      .from('assignments')
      .select('title, due_at')
      .eq('user_id', userId)
      .neq('status', 'done')
      .lt('due_at', startOfDayUTC(today).toISOString())
      .limit(20),
    admin.from('deferrals').select('assignment_id').eq('user_id', userId),
    admin.from('assignments').select('id, title').eq('user_id', userId).neq('status', 'done'),
  ]);

  const counts = new Map<string, number>();
  for (const row of (deferralRows.data ?? []) as { assignment_id: string }[]) {
    counts.set(row.assignment_id, (counts.get(row.assignment_id) ?? 0) + 1);
  }

  const stuck = ((openWork.data ?? []) as { id: string; title: string }[])
    .map((a) => ({ title: a.title, deferrals: counts.get(a.id) ?? 0 }))
    .filter((a) => a.deferrals >= 6)
    .sort((a, b) => b.deferrals - a.deferrals);

  return {
    today,
    // deno-lint-ignore no-explicit-any
    finished: ((finished.data ?? []) as any[]).map((a) => ({ title: a.title })),
    // deno-lint-ignore no-explicit-any
    upcoming: ((upcoming.data ?? []) as any[]).map((a) => ({
      title: a.title,
      due_day: localDayKey(new Date(a.due_at)),
      effort_minutes: a.effort_minutes,
    })),
    // deno-lint-ignore no-explicit-any
    overdue: ((overdue.data ?? []) as any[]).map((a) => ({
      title: a.title,
      due_day: localDayKey(new Date(a.due_at)),
    })),
    stuck,
  };
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
      .select('user_id, timezone, digest_hour, digest_minute, digest_enabled, assignment_window_days, event_window_days, weekly_review_enabled, weekly_review_weekday');

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

    // The weekly review runs on the same pass but is independent of the
    // digest: both can go out on the same morning, and neither failing should
    // stop the other.
    for (const settings of (data ?? []) as SettingsRow[]) {
      const localDay = localDayKey(now, settings.timezone);

      const { count } = await admin
        .from('delivery_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', settings.user_id)
        .eq('kind', 'weekly')
        .eq('local_day', localDay)
        .eq('status', 'sent');

      const decision = decideWeekly(settings, now, (count ?? 0) > 0);
      if (!decision.send) continue;

      const msg = buildWeekly(await gatherWeekly(admin, settings.user_id, decision.localDay));
      const outcome = await deliver(deps, settings.user_id, 'weekly', decision.localDay, msg);

      results.push({
        user: settings.user_id,
        weekly: outcome.delivered,
        channel: outcome.channel,
        errors: outcome.errors,
      });
    }

    // Escalations and reminders run independently of the digest and of each
    // other: different hours, different idempotency keys, and no reason for
    // one to block another.
    for (const settings of (data ?? []) as SettingsRow[]) {
      const escalated = await runEscalations(admin, deps, settings, now);
      if (escalated.length) results.push({ user: settings.user_id, escalations: escalated });

      const reminded = await runReminders(admin, deps, settings, now);
      if (reminded.length) results.push({ user: settings.user_id, reminders: reminded });
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

/**
 * Sends any per-item reminder whose moment has arrived.
 *
 * Checklist reminders repeat and are suppressed once the item is ticked;
 * assignment reminders happen once. Both are keyed so the 15-minute scheduler
 * can re-enter their window harmlessly.
 */
async function runReminders(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  deps: any,
  settings: SettingsRow,
  now: Date,
): Promise<string[]> {
  const localDay = localDayKey(now, settings.timezone);
  const sent: string[] = [];

  const alreadySent = async (key: string): Promise<boolean> => {
    const { count } = await admin
      .from('delivery_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', settings.user_id)
      .eq('kind', 'reminder')
      .eq('dedupe_key', key)
      .eq('status', 'sent');
    return (count ?? 0) > 0;
  };

  const send = async (title: string, key: string) => {
    if (await alreadySent(key)) return;
    const msg = renderReminder(title, APP_URL);
    const outcome = await deliver(deps, settings.user_id, 'reminder', localDay, msg, key);
    if (outcome.delivered) sent.push(title);
  };

  // ---- checklist ---------------------------------------------------------
  const [{ data: items }, { data: completions }] = await Promise.all([
    admin
      .from('checklist_items')
      .select('*')
      .eq('user_id', settings.user_id)
      .eq('active', true)
      .not('remind_at', 'is', null),
    admin
      .from('checklist_completions')
      .select('item_id')
      .eq('user_id', settings.user_id)
      .eq('local_day', localDay),
  ]);

  const done = new Set(((completions ?? []) as { item_id: string }[]).map((c) => c.item_id));

  for (const item of checklistRemindersDue(
    (items ?? []) as RemindableItem[],
    done,
    localDay,
    now,
    settings.timezone,
  )) {
    await send(item.title, checklistReminderKey(item.id, localDay));
  }

  // ---- assignments -------------------------------------------------------
  const { data: work } = await admin
    .from('assignments')
    .select('id, title, status, remind_at')
    .eq('user_id', settings.user_id)
    .neq('status', 'done')
    .not('remind_at', 'is', null);

  for (const a of assignmentRemindersDue((work ?? []) as RemindableAssignment[], now)) {
    await send(a.title, assignmentReminderKey(a.id, a.remind_at!));
  }

  return sent;
}

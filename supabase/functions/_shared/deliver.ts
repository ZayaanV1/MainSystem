/**
 * The delivery layer.
 *
 * `deliver()` is the only function the rest of the system calls to put a
 * message on the phone. It knows nothing about what the message says; the
 * digest builder knows nothing about where it goes. Swapping Telegram for Web
 * Push is a change to one row in `notification_channels` and nothing else.
 *
 * Behaviour worth stating explicitly, because both directions are wrong in
 * ways that are hard to notice:
 *
 *  - Channels are tried in priority order and delivery STOPS at the first
 *    success. Two notifications for one digest trains you to ignore both.
 *  - A failure falls through to the next channel. During the Web Push soak
 *    that means Web Push goes first and Telegram silently catches the misses,
 *    so the digest still arrives while the delivery log records who actually
 *    delivered it. That log is the soak result.
 *  - Every attempt is written to `delivery_log`, successful or not. A dead
 *    pipeline must never be indistinguishable from a quiet week.
 */

import { sendTelegram, type TelegramConfig } from './channels/telegram.ts';
import { sendWebPush, type PushSubscription, type VapidKeys } from './channels/webpush.ts';
import type { ChannelKind, DeliveryKind, OutboundMessage, SendResult } from './types.ts';
import type { DayKey } from './time.ts';

/** Minimal structural view of the Supabase client, so this file stays testable. */
// deno-lint-ignore no-explicit-any
type Db = any;

export interface DeliverDeps {
  db: Db;
  telegramBotToken: string;
  vapid: VapidKeys;
}

export interface DeliveryOutcome {
  delivered: boolean;
  channel?: ChannelKind;
  /** One entry per channel that was tried and failed. */
  errors: string[];
  /** True when the digest for this local day had already gone out. */
  duplicate?: boolean;
}

interface ChannelRow {
  id: string;
  kind: ChannelKind;
  config: Record<string, unknown>;
  priority: number;
}

/**
 * Postgres unique-violation. Raised by the one-digest-per-local-day index when
 * the scheduler re-enters the window, which is expected rather than
 * exceptional — the scheduler is deliberately dumb and fires every 15 minutes.
 */
const UNIQUE_VIOLATION = '23505';

export async function deliver(
  deps: DeliverDeps,
  userId: string,
  kind: DeliveryKind,
  localDay: DayKey,
  msg: OutboundMessage,
  /** Identity for non-digest notifications, so a repeat send is rejected. */
  dedupeKey?: string,
): Promise<DeliveryOutcome> {
  const { db } = deps;

  const { data: channels } = await db
    .from('notification_channels')
    .select('id, kind, config, priority')
    .eq('user_id', userId)
    .eq('enabled', true)
    .is('failed_at', null)
    .order('priority', { ascending: true });

  const rows: ChannelRow[] = channels ?? [];

  if (rows.length === 0) {
    await log(db, userId, kind, null, localDay, 'skipped', msg, 'no notification channel configured', dedupeKey);
    return { delivered: false, errors: ['no notification channel configured'] };
  }

  const errors: string[] = [];

  for (const channel of rows) {
    const result = await attempt(deps, userId, channel, msg);

    if (result.ok) {
      const logged = await log(db, userId, kind, channel.kind, localDay, 'sent', msg, null, dedupeKey);
      if (logged === 'duplicate') {
        return { delivered: true, channel: channel.kind, errors, duplicate: true };
      }
      return { delivered: true, channel: channel.kind, errors };
    }

    errors.push(result.error);
    await log(db, userId, kind, channel.kind, localDay, 'failed', msg, result.error, dedupeKey);

    // Retire the channel only when the failure means it will never work again
    // without the user doing something. Everything else gets retried tomorrow.
    if (result.dead) {
      await db
        .from('notification_channels')
        .update({ failed_at: new Date().toISOString(), failure_reason: result.error })
        .eq('id', channel.id);
    }
  }

  return { delivered: false, errors };
}

async function attempt(
  deps: DeliverDeps,
  userId: string,
  channel: ChannelRow,
  msg: OutboundMessage,
): Promise<SendResult> {
  if (channel.kind === 'telegram') {
    return sendTelegram(msg, channel.config as unknown as TelegramConfig, deps.telegramBotToken);
  }

  if (channel.kind === 'webpush') {
    return sendToAllDevices(deps, userId, msg);
  }

  return { ok: false, error: `unknown channel kind: ${channel.kind}`, dead: true };
}

/**
 * Web Push is per-device, not per-user: one subscription per installed PWA.
 * Success on any device counts as delivered — the point is that the phone
 * buzzed, not that every browser did.
 *
 * Endpoints that return 404 or 410 are deleted immediately. On iOS this is
 * routine rather than exceptional: offloading the app, reinstalling it from
 * the home screen, or some OS updates all invalidate the subscription without
 * telling anyone. The client re-subscribes on next launch.
 */
async function sendToAllDevices(
  deps: DeliverDeps,
  userId: string,
  msg: OutboundMessage,
): Promise<SendResult> {
  const { db } = deps;

  const { data: subs } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  const devices: (PushSubscription & { id: string })[] = subs ?? [];

  if (devices.length === 0) {
    return { ok: false, error: 'webpush: no device is subscribed', dead: false };
  }

  const errors: string[] = [];
  let anyDelivered = false;
  let allDead = true;

  for (const device of devices) {
    const result = await sendWebPush(msg, device, deps.vapid);

    if (result.ok) {
      anyDelivered = true;
      allDead = false;
      await db
        .from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString() })
        .eq('id', device.id);
      continue;
    }

    errors.push(result.error);
    if (result.dead) {
      await db.from('push_subscriptions').delete().eq('id', device.id);
    } else {
      allDead = false;
    }
  }

  if (anyDelivered) return { ok: true };

  // Only retire the whole channel if every device is gone. A single rotted
  // endpoint must not stop Web Push being tried after the app is reinstalled.
  return { ok: false, error: errors.join('; '), dead: allDead };
}

/**
 * Records the attempt. Returns 'duplicate' when the one-digest-per-day index
 * rejected the row, which means another run beat us to it — not an error.
 */
async function log(
  db: Db,
  userId: string,
  kind: DeliveryKind,
  channel: ChannelKind | null,
  localDay: DayKey,
  status: 'sent' | 'failed' | 'skipped',
  msg: OutboundMessage,
  error: string | null,
  dedupeKey?: string,
): Promise<'ok' | 'duplicate'> {
  const { error: insertError } = await db.from('delivery_log').insert({
    user_id: userId,
    kind,
    channel,
    local_day: localDay,
    status,
    error,
    dedupe_key: dedupeKey ?? null,
    payload: { title: msg.title, body: msg.body },
  });

  if (insertError?.code === UNIQUE_VIOLATION) return 'duplicate';
  return 'ok';
}

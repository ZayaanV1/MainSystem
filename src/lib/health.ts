import { supabase } from './supabase';
import { localDayKey, formatDay, formatTime } from './time';

/**
 * Notification health.
 *
 * The spec says silence is indistinguishable from a broken pipeline, and
 * applies that to digest content. This applies the same idea one level down,
 * to the infrastructure — because the failure mode is worse there.
 *
 * A Web Push subscription can die without any error anywhere. The only symptom
 * is that the 07:00 digest stops arriving, and that is indistinguishable from
 * a genuinely quiet week. You would not notice for a fortnight, and the
 * fortnight you did not notice is exactly the one where you needed it.
 *
 * So: the last successful delivery is surfaced in the app, and goes stale
 * loudly.
 */

export interface NotificationHealth {
  lastDeliveredAt: Date | null;
  lastChannel: string | null;
  /** Failed attempts since the last success. */
  failuresSince: number;
  /** No successful delivery for longer than a day and a half. */
  stale: boolean;
  /** Nothing configured to deliver to. */
  noChannel: boolean;
}

const STALE_AFTER_HOURS = 36;

export async function fetchHealth(): Promise<NotificationHealth> {
  const [{ data: lastSent }, { data: channels }] = await Promise.all([
    supabase
      .from('delivery_log')
      .select('created_at, channel')
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('notification_channels')
      .select('id')
      .eq('enabled', true)
      .is('failed_at', null),
  ]);

  const last = lastSent?.[0] ?? null;
  const lastDeliveredAt = last ? new Date(last.created_at) : null;

  const { count } = await supabase
    .from('delivery_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gte('created_at', lastDeliveredAt?.toISOString() ?? '1970-01-01T00:00:00Z');

  const ageHours = lastDeliveredAt
    ? (Date.now() - lastDeliveredAt.getTime()) / 3_600_000
    : Infinity;

  return {
    lastDeliveredAt,
    lastChannel: last?.channel ?? null,
    failuresSince: count ?? 0,
    stale: ageHours > STALE_AFTER_HOURS,
    noChannel: (channels?.length ?? 0) === 0,
  };
}

/**
 * One line, stated plainly. Never praise, never alarm — a fact and, when
 * something is wrong, what to do about it.
 */
export function describeHealth(h: NotificationHealth): { text: string; warn: boolean } {
  if (h.noChannel) {
    // "Run setup" was true when the only user also owned the terminal. To
    // anyone else it is an instruction they cannot follow, on a screen with no
    // terminal in it. Point at the thing in the app that actually does it.
    return { text: 'Notifications are off. Turn them on in Settings.', warn: true };
  }

  if (!h.lastDeliveredAt) {
    return { text: 'No notification delivered yet. Send a test.', warn: true };
  }

  const day = localDayKey(h.lastDeliveredAt);
  const today = localDayKey();
  const when =
    day === today
      ? `today ${formatTime(h.lastDeliveredAt)}`
      : `${formatDay(day)} ${formatTime(h.lastDeliveredAt)}`;

  if (h.stale) {
    return { text: `Last notification ${when}. Send a test to check.`, warn: true };
  }

  const suffix = h.failuresSince > 0 ? ` ${h.failuresSince} failed since.` : '';
  return { text: `Last notification ${when}.${suffix}`, warn: h.failuresSince > 0 };
}

export interface DeliveryRow {
  id: string;
  created_at: string;
  kind: string;
  channel: string | null;
  status: string;
  error: string | null;
}

export async function fetchDeliveryLog(limit = 20): Promise<DeliveryRow[]> {
  const { data } = await supabase
    .from('delivery_log')
    .select('id, created_at, kind, channel, status, error')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

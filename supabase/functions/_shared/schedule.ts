/**
 * When should the digest go out?
 *
 * Kept pure and free of I/O so it can be tested exhaustively, because this is
 * the piece most likely to be quietly wrong. pg_cron schedules in UTC, and
 * 07:00 in Montreal is 11:00Z for part of the year and 12:00Z for the rest.
 * Rather than encode that in a crontab that would need editing twice a year,
 * the scheduler runs often and dumbly and this function decides.
 */

import { localDayKey, minutesSinceLocal, type DayKey } from './time.ts';

export interface DigestSettings {
  timezone: string;
  digest_hour: number;
  digest_minute: number;
  digest_enabled: boolean;
}

export type DigestDecision =
  | { send: false; reason: 'disabled' | 'already-sent' | 'too-early' | 'window-missed'; localDay: DayKey }
  | { send: true; localDay: DayKey; minutesLate: number };

/**
 * How long after the configured time the digest may still be sent.
 *
 * Three hours, not unlimited. If the scheduler was down at 07:00, a digest at
 * 09:30 is still useful; one at 16:00 is not a morning digest, it is a
 * confusing notification about a day that is already half gone. Past the
 * window the run is recorded as skipped rather than sent, so the gap is
 * visible in the delivery log instead of silently vanishing.
 */
export const CATCH_UP_MINUTES = 180;

/**
 * The scheduler is expected to fire several times inside this window. The
 * one-digest-per-local-day unique index in the database is what makes that
 * safe; `alreadySentToday` is the cheap check that avoids relying on a
 * constraint violation for normal control flow.
 */
export function decideDigest(
  settings: DigestSettings,
  now: Date,
  alreadySentToday: boolean,
  catchUpMinutes: number = CATCH_UP_MINUTES,
): DigestDecision {
  const localDay = localDayKey(now, settings.timezone);

  if (!settings.digest_enabled) return { send: false, reason: 'disabled', localDay };
  if (alreadySentToday) return { send: false, reason: 'already-sent', localDay };

  const elapsed = minutesSinceLocal(
    settings.digest_hour,
    settings.digest_minute,
    now,
    settings.timezone,
  );

  if (elapsed < 0) return { send: false, reason: 'too-early', localDay };
  if (elapsed > catchUpMinutes) return { send: false, reason: 'window-missed', localDay };

  return { send: true, localDay, minutesLate: elapsed };
}

/**
 * The time layer. Canonical copy.
 *
 * This module lives under supabase/functions so the Deno edge runtime bundles
 * it, and `src/lib/time.ts` re-exports it for the browser. One copy, two
 * runtimes — because the browser deciding what "today" means and the digest
 * deciding when 07:00 is must never disagree.
 *
 * One rule governs this file: a "day" is the user's local day in Montreal,
 * never a UTC day. Timestamps are stored as UTC instants and rendered in
 * America/Toronto. "Today" is computed from the local calendar date.
 *
 * Everything here must survive DST. Toronto shifts twice a year, and the two
 * bugs that follow from getting it wrong are both silent and both bad: a task
 * due "today" disappearing at 8pm because UTC has already rolled over, and the
 * 07:00 digest arriving at 06:00 for half the year.
 *
 * No dependencies. Intl is in every browser and in Deno.
 */

export const TZ = 'America/Toronto';

/** A local calendar date, 'YYYY-MM-DD'. Never a timestamp. */
export type DayKey = string;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Formatters, built once per zone and then reused.
 *
 * Every function below used to construct a fresh Intl.DateTimeFormat on each
 * call, and construction is the expensive part: it resolves locale data and
 * the zone's rules, where formatting with an existing formatter is cheap.
 * `wallClockToUTC` builds two per conversion, so a calendar feed with a few
 * thousand events built tens of thousands of them — measured at 542 ms for a
 * realistic six-year calendar on a laptop, enough on a slower edge isolate to
 * run a sync into its two-second CPU ceiling and have it killed mid-write.
 *
 * Safe to cache because a formatter is immutable: `formatToParts` has no
 * state. Keyed by purpose and zone; the set of zones any one process meets is
 * small, so the map stays small.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  purpose: string,
  tz: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${purpose}|${tz}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: tz });
    formatters.set(key, f);
  }
  return f;
}

/**
 * Offset of `tz` from UTC at a given instant, in milliseconds.
 *
 * Works by formatting the instant as local wall-clock time, reading that back
 * as though it were UTC, and taking the difference. Correct across DST because
 * it asks Intl what the offset actually was at that moment rather than
 * assuming a fixed one.
 */
function tzOffsetMs(instant: Date, tz: string = TZ): number {
  const dtf = formatter('offset', tz, 'en-US', {
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const p: Record<string, number> = {};
  for (const { type, value } of dtf.formatToParts(instant)) {
    if (type !== 'literal') p[type] = Number(value);
  }

  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Zero out the sub-second component the formatter dropped, so the difference
  // is a clean offset rather than offset-minus-milliseconds.
  return asIfUTC - (instant.getTime() - instant.getUTCMilliseconds());
}

/** The local calendar date containing `instant`. */
export function localDayKey(instant: Date = new Date(), tz: string = TZ): DayKey {
  const dtf = formatter('day', tz, 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const p: Record<string, string> = {};
  for (const { type, value } of dtf.formatToParts(instant)) {
    if (type !== 'literal') p[type] = value;
  }

  return `${p.year}-${p.month}-${p.day}`;
}

/** Today, as the user's local calendar date. */
export function todayKey(now: Date = new Date(), tz: string = TZ): DayKey {
  return localDayKey(now, tz);
}

/**
 * Local wall-clock hour and minute at an instant.
 *
 * This is what the scheduler consults to decide whether it is currently the
 * user's digest time. It must be read from the zone, never from the server's
 * own clock — the edge function has no idea where it is running.
 */
export function localHourMinute(
  instant: Date = new Date(),
  tz: string = TZ,
): { hour: number; minute: number } {
  const dtf = formatter('hourMinute', tz, 'en-US', {
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });

  const p: Record<string, number> = {};
  for (const { type, value } of dtf.formatToParts(instant)) {
    if (type !== 'literal') p[type] = Number(value);
  }

  return { hour: p.hour, minute: p.minute };
}

/**
 * Minutes elapsed since a local wall-clock time, on the same local day.
 *
 * Negative if that time has not arrived yet. Used by the scheduler to answer
 * "is it digest time, or did we miss it" in one number.
 */
export function minutesSinceLocal(
  hour: number,
  minute: number,
  now: Date = new Date(),
  tz: string = TZ,
): number {
  const local = localHourMinute(now, tz);
  return local.hour * 60 + local.minute - (hour * 60 + minute);
}

/**
 * The UTC instant of a given local wall-clock time on a given local date.
 *
 * This is how the 07:00 digest is reasoned about: `wallClockToUTC('2026-11-01', 7)`
 * returns 12:00Z, and the day before the fall-back it returns 11:00Z. The
 * digest keeps arriving at 07:00 in Montreal either way.
 *
 * Resolved in two passes because the offset depends on the instant we are
 * still solving for. The first pass gets close; the second corrects it if the
 * guess landed on the far side of a DST transition.
 */
export function wallClockToUTC(
  day: DayKey,
  hour = 0,
  minute = 0,
  second = 0,
  tz: string = TZ,
): Date {
  const [y, m, d] = day.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute, second);

  const firstGuess = naive - tzOffsetMs(new Date(naive), tz);
  const corrected = naive - tzOffsetMs(new Date(firstGuess), tz);

  return new Date(corrected);
}

/** The UTC instant at which the local day begins (local midnight). */
export function startOfDayUTC(day: DayKey, tz: string = TZ): Date {
  return wallClockToUTC(day, 0, 0, 0, tz);
}

/**
 * The UTC instant at which the local day ends — exclusive.
 *
 * Computed as the start of the following day rather than 23:59:59 of this one,
 * so a fall-back day is correctly 25 hours long and nothing logged in the
 * repeated hour falls outside its own day.
 */
export function endOfDayUTC(day: DayKey, tz: string = TZ): Date {
  return startOfDayUTC(addDays(day, 1), tz);
}

/**
 * Calendar arithmetic on day keys.
 *
 * Deliberately operates on the calendar rather than on instants, so it cannot
 * be perturbed by DST at all: "the day after March 7" is March 8 regardless of
 * that day being 23 hours long.
 */
export function addDays(day: DayKey, n: number): DayKey {
  const [y, m, d] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + n));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * ISO weekday for a day key: 1 = Monday through 7 = Sunday.
 *
 * Computed from the calendar rather than from an instant, so it cannot be
 * shifted by a DST transition or by the host's timezone.
 */
export function isoWeekday(day: DayKey): number {
  const [y, m, d] = day.split('-').map(Number);
  const sunday0 = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

/** Whole calendar days from `from` to `to`. Negative if `to` is earlier. */
export function daysBetween(from: DayKey, to: DayKey): number {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Whole days from now until a stored UTC timestamp, measured in local
 * calendar days.
 *
 * This is what drives the proximity colour flags, and it is measured in days
 * rather than hours on purpose: something due at 9am tomorrow and something
 * due at 11pm tomorrow are both "tomorrow" to a person looking at a list.
 */
export function daysUntil(due: Date, now: Date = new Date(), tz: string = TZ): number {
  return daysBetween(localDayKey(now, tz), localDayKey(due, tz));
}

/** Is this stored timestamp on the user's current local day? */
export function isToday(instant: Date, now: Date = new Date(), tz: string = TZ): boolean {
  return localDayKey(instant, tz) === localDayKey(now, tz);
}

/**
 * The offset abbreviation in effect at an instant — 'EST' or 'EDT'.
 * Used when showing the user a time whose zone might be in question.
 */
export function zoneAbbrev(instant: Date = new Date(), tz: string = TZ): string {
  const parts = formatter('abbrev', tz, 'en-US', { timeZoneName: 'short' }).formatToParts(instant);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** Render a stored instant as local wall-clock time, e.g. '7:00 a.m.' */
export function formatTime(instant: Date, tz: string = TZ): string {
  return formatter('time', tz, 'en-CA', { hour: 'numeric', minute: '2-digit' }).format(instant);
}

/** Render a day key for display, e.g. 'Sat, Aug 15'. */
export function formatDay(day: DayKey, tz: string = TZ): string {
  return formatter('dayLabel', tz, 'en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(startOfDayUTC(day, tz));
}

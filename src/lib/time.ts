import * as shared from '../../supabase/functions/_shared/time';

export type { DayKey } from '../../supabase/functions/_shared/time';
export { addDays, daysBetween, isoWeekday } from '../../supabase/functions/_shared/time';

/**
 * The time layer, for the browser.
 *
 * The arithmetic lives under supabase/functions/_shared so the Deno edge
 * runtime bundles the same copy. The client deciding what "today" means and
 * the digest deciding when 07:00 is are the same question, and two answers to
 * it would eventually disagree.
 *
 * What this file adds is WHOSE day it is.
 *
 * The shared functions all take a timezone and default it to a constant, which
 * was correct while there was one user in one city. Now the default has to
 * follow the account, and threading a zone through several hundred call sites
 * would be a change with a hundred chances to miss one — and a missed one is
 * silent, producing a deadline that is wrong by hours rather than an error.
 *
 * So the zone is module state here, set once when settings load, and every
 * wrapper below defaults to it. Callers are unchanged.
 *
 * This is deliberately NOT done in the shared module. On the server one
 * process serves every user in a single cron pass, and a mutable global there
 * would let one account's zone leak into another's digest. The edge functions
 * keep passing an explicit zone per user, which is why the shared functions
 * still take the argument at all.
 */

/**
 * Where the browser thinks it is.
 *
 * The right default for an account that has not said otherwise: better than
 * any city this app could pick, and it needs no question at signup.
 */
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || shared.TZ;
  } catch {
    return shared.TZ;
  }
}

let active = browserZone();

/**
 * Points the app at an account's timezone.
 *
 * Called once when settings load. The stored zone wins over the browser's on
 * purpose: deadlines belong to the term, not to where the laptop is today, so
 * travelling must not move what is due.
 */
export function setActiveTimezone(tz: string | null | undefined): void {
  if (!tz) return;
  // A bad value here would make every date in the app throw, so it is checked
  // once rather than trusted from a settings row.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    active = tz;
  } catch {
    // Keep whatever was working. A wrong zone is bad; a crashing one is worse.
  }
}

/** The zone every function below uses when not given one. */
export function activeTimezone(): string {
  return active;
}

/** The browser's own zone, for offering a default the user can accept. */
export const detectedTimezone = browserZone;

/* -------------------------------------------------------------------------
   Wrappers. Each one exists only to supply `active` as the default zone.
   Passing a zone explicitly still works and still bypasses all of this.
   ---------------------------------------------------------------------- */

export const localDayKey = (instant: Date = new Date(), tz: string = active) =>
  shared.localDayKey(instant, tz);

export const todayKey = (now: Date = new Date(), tz: string = active) =>
  shared.todayKey(now, tz);

export const localHourMinute = (instant: Date = new Date(), tz: string = active) =>
  shared.localHourMinute(instant, tz);

export const minutesSinceLocal = (
  hour: number,
  minute: number,
  now: Date = new Date(),
  tz: string = active,
) => shared.minutesSinceLocal(hour, minute, now, tz);

export const wallClockToUTC = (
  day: shared.DayKey,
  hour = 0,
  minute = 0,
  second = 0,
  tz: string = active,
) => shared.wallClockToUTC(day, hour, minute, second, tz);

export const startOfDayUTC = (day: shared.DayKey, tz: string = active) =>
  shared.startOfDayUTC(day, tz);

export const endOfDayUTC = (day: shared.DayKey, tz: string = active) =>
  shared.endOfDayUTC(day, tz);

export const daysUntil = (due: Date, now: Date = new Date(), tz: string = active) =>
  shared.daysUntil(due, now, tz);

export const isToday = (instant: Date, now: Date = new Date(), tz: string = active) =>
  shared.isToday(instant, now, tz);

export const zoneAbbrev = (instant: Date = new Date(), tz: string = active) =>
  shared.zoneAbbrev(instant, tz);

export const formatTime = (instant: Date, tz: string = active) =>
  shared.formatTime(instant, tz);

export const formatDay = (day: shared.DayKey, tz: string = active) =>
  shared.formatDay(day, tz);

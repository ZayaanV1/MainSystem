import { addDays, isoWeekday, localDayKey, minutesSinceLocal, type DayKey } from './time.ts';

/**
 * The weekly review.
 *
 * One message on a chosen weekday: what got finished, what is due next, what
 * has gone past its date, and what has been sitting long enough to be worth
 * rethinking.
 *
 * The line this walks is rule 3. A weekly summary is the most natural place in
 * the whole app for a streak to appear, and it is the place it would do the
 * most damage — a scored week is a week you can fail, and the app has to stay
 * openable on the bad ones.
 *
 * So: finished work is listed as facts about the week, never counted against
 * a target and never compared with last week. Nothing that did not happen is
 * mentioned as a miss. An empty week gets a neutral sentence, not a lament.
 */

export interface WeeklyInput {
  today: DayKey;
  /** Finished in the seven days ending today. */
  finished: { title: string }[];
  /** Open work with a date in the seven days starting tomorrow. */
  upcoming: { title: string; due_day: DayKey; effort_minutes: number | null }[];
  /** Open work already past its date. */
  overdue: { title: string; due_day: DayKey }[];
  /** Open work pushed past the threshold. */
  stuck: { title: string; deferrals: number }[];
}

export interface WeeklyMessage {
  title: string;
  body: string;
}

export interface WeeklySettings {
  timezone: string;
  weekly_review_enabled: boolean;
  weekly_review_weekday: number;
  digest_hour: number;
  digest_minute: number;
}

export type WeeklyDecision =
  | { send: true; localDay: DayKey }
  | { send: false; reason: 'disabled' | 'wrong-day' | 'too-early' | 'window-missed' | 'already-sent'; localDay: DayKey };

/** Same catch-up window as the morning digest: a late send beats none. */
const CATCH_UP_MINUTES = 120;

export function decideWeekly(
  settings: WeeklySettings,
  now: Date,
  alreadySent: boolean,
  catchUpMinutes: number = CATCH_UP_MINUTES,
): WeeklyDecision {
  const localDay = localDayKey(now, settings.timezone);

  if (!settings.weekly_review_enabled) return { send: false, reason: 'disabled', localDay };
  if (isoWeekday(localDay) !== settings.weekly_review_weekday) {
    return { send: false, reason: 'wrong-day', localDay };
  }
  if (alreadySent) return { send: false, reason: 'already-sent', localDay };

  const elapsed = minutesSinceLocal(
    settings.digest_hour,
    settings.digest_minute,
    now,
    settings.timezone,
  );

  if (elapsed < 0) return { send: false, reason: 'too-early', localDay };
  if (elapsed > catchUpMinutes) return { send: false, reason: 'window-missed', localDay };

  return { send: true, localDay };
}

const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

export function buildWeekly(input: WeeklyInput): WeeklyMessage {
  const lines: string[] = [];

  if (input.finished.length > 0) {
    // Named, not counted. "You finished 4 things" invites a comparison with
    // last week, which is the first step to a score.
    lines.push(
      `Finished: ${input.finished.slice(0, 6).map((f) => f.title).join(', ')}` +
        (input.finished.length > 6 ? `, and ${input.finished.length - 6} more.` : '.'),
    );
  }

  if (input.overdue.length > 0) {
    lines.push(
      `Past its date: ${input.overdue.slice(0, 4).map((o) => o.title).join(', ')}` +
        (input.overdue.length > 4 ? `, and ${input.overdue.length - 4} more.` : '.'),
    );
  }

  if (input.upcoming.length > 0) {
    const known = input.upcoming.filter((u) => u.effort_minutes !== null);
    const total = known.reduce((n, u) => n + (u.effort_minutes ?? 0), 0);
    const unsized = input.upcoming.length - known.length;

    let line = `Next seven days: ${input.upcoming.length} ${input.upcoming.length === 1 ? 'thing' : 'things'} due`;
    if (total > 0) line += `, ${hours(total)} hours of it estimated`;
    if (unsized > 0) line += `, ${unsized} with no estimate`;
    lines.push(`${line}.`);
  } else {
    lines.push('Nothing is due in the next seven days.');
  }

  if (input.stuck.length > 0) {
    const worst = input.stuck[0];
    lines.push(
      `"${worst.title}" has moved ${worst.deferrals} times. Worth breaking into a first step, or dropping.`,
    );
  }

  // An empty week is a fact, not a failure, and gets said plainly.
  if (lines.length === 0) lines.push('A quiet week, with nothing due and nothing outstanding.');

  return {
    title: `Week of ${weekLabel(input.today)}`,
    body: lines.join('\n'),
  };
}

/** The Monday of the week the given day starts. */
function weekLabel(today: DayKey): string {
  const weekday = isoWeekday(today);
  // Sent on Sunday by default, which belongs to the week that is starting.
  const monday = weekday === 7 ? addDays(today, 1) : addDays(today, -(weekday - 1));
  const [y, m, d] = monday.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

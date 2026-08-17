import { addDays, daysUntil, localDayKey, type DayKey } from './time';

/**
 * Proximity flags.
 *
 * The colour law says urgency is a warm earth ramp used on edge bars, text and
 * icon tint — never on a ring. It also says colour is never the only signal,
 * so every state here carries a written label and this module returns both.
 * A component that renders the colour without the label is breaking the rule,
 * and the shape of this return value is meant to make that awkward.
 *
 * Thresholds are user-editable and arrive from app_settings.
 */

export type UrgencyState =
  | 'done'
  | 'overdue'
  | 'critical'
  | 'urgent'
  | 'approaching'
  | 'distant'
  | 'undated';

export interface Thresholds {
  critical_days: number;
  urgent_days: number;
  approaching_days: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  critical_days: 2,
  urgent_days: 5,
  approaching_days: 14,
};

export interface Urgency {
  state: UrgencyState;
  /** Token name for the edge bar or text tint. Never a literal colour. */
  colourVar: string;
  /** The written signal. Always rendered alongside the colour. */
  label: string;
  /** Calendar days until due. Negative when overdue, null when undated. */
  days: number | null;
}

const COLOUR: Record<UrgencyState, string> = {
  done: '--t-done',
  overdue: '--t-overdue',
  critical: '--t-critical',
  urgent: '--t-urgent',
  approaching: '--t-approaching',
  distant: '--t-distant',
  // An undated item is not urgent and not calm — it is simply unscheduled, so
  // it borrows the least-loud mark in the ramp rather than inventing a colour.
  undated: '--t-distant',
};

/**
 * Plain, factual, sentence case. No exclamation marks, and nothing that
 * implies fault: "3 days late" is a fact, "you're 3 days late" is a scold, and
 * the second one is how an app stops getting opened.
 */
function describe(state: UrgencyState, days: number | null): string {
  switch (state) {
    case 'done':
      return 'Done';
    case 'undated':
      return 'No date';
    case 'overdue': {
      const late = Math.abs(days ?? 0);
      return late === 0 ? 'Overdue' : `${late} ${late === 1 ? 'day' : 'days'} late`;
    }
    default:
      if (days === 0) return 'Due today';
      if (days === 1) return 'Due tomorrow';
      return `${days} days`;
  }
}

export function urgencyFor(
  dueAt: Date | null,
  options: {
    done?: boolean;
    now?: Date;
    thresholds?: Thresholds;
    timezone?: string;
  } = {},
): Urgency {
  const { done = false, now = new Date(), thresholds = DEFAULT_THRESHOLDS, timezone } = options;

  if (done) return { state: 'done', colourVar: COLOUR.done, label: describe('done', null), days: null };

  if (!dueAt) {
    return { state: 'undated', colourVar: COLOUR.undated, label: describe('undated', null), days: null };
  }

  const days = daysUntil(dueAt, now, timezone);

  const state: UrgencyState =
    days < 0
      ? 'overdue'
      : days <= thresholds.critical_days
        ? 'critical'
        : days <= thresholds.urgent_days
          ? 'urgent'
          : days <= thresholds.approaching_days
            ? 'approaching'
            : 'distant';

  return { state, colourVar: COLOUR[state], label: describe(state, days), days };
}

/* ------------------------------------------------------------- start by --- */

/**
 * Focused minutes assumed available per day for a single piece of work.
 *
 * Deliberately modest. The number's job is to manufacture a start date that
 * feels real, not to model a schedule — and an optimistic figure produces a
 * "start by" that is already impossible, which teaches you to ignore it.
 */
export const DAILY_CAPACITY_MINUTES = 90;

/**
 * The date to start, derived from the due date and the effort estimate.
 *
 * With ADHD the due date is often the only date that feels real. This
 * manufactures an earlier one that also does. It can land in the past, and
 * that is useful information rather than a bug — it means the work needed to
 * have begun already.
 *
 * Returns null when there is nothing to derive from. A stored override always
 * wins, so changing this rule later never rewrites a date set by hand.
 */
export function startBy(
  dueAt: Date | null,
  effortMinutes: number | null,
  override: DayKey | null = null,
  timezone?: string,
): DayKey | null {
  if (override) return override;
  if (!dueAt || !effortMinutes || effortMinutes <= 0) return null;

  const daysNeeded = Math.max(1, Math.ceil(effortMinutes / DAILY_CAPACITY_MINUTES));
  return addDays(localDayKey(dueAt, timezone), -daysNeeded);
}

/**
 * Should the start-by date be surfaced?
 *
 * Only once it is relevant — showing "start by 12 December" in August is
 * noise, and noise on this screen is what makes the screen ignorable.
 */
export function startByIsDue(start: DayKey | null, now: Date = new Date(), timezone?: string): boolean {
  if (!start) return false;
  return localDayKey(now, timezone) >= start;
}

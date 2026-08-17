import { addDays, daysBetween, isoWeekday, type DayKey } from './time';

/**
 * Checklist logic: which items are due on a given day, and how the medication
 * counter reads.
 *
 * Pure and free of I/O, because both of these are quietly load-bearing. An
 * item that fails to appear is indistinguishable from one that was done, and
 * a dose count that drifts is worse than no count at all.
 */

export type RecurrenceKind = 'daily' | 'weekdays' | 'interval';

export interface ChecklistItem {
  id: string;
  title: string;
  recurrence: RecurrenceKind;
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. Only for 'weekdays'. */
  weekdays: number[] | null;
  interval_days: number | null;
  anchor_day: DayKey | null;
  active: boolean;
  sort_order: number;

  tracks_doses: boolean;
  doses_remaining: number | null;
  doses_per_completion: number;
  refill_warning_days: number;
}

/**
 * Is this item expected on this local day?
 *
 * An inactive item is never due. An interval item is due on its anchor day and
 * every N days after — and, deliberately, not before its anchor: an item
 * configured today should not retroactively appear to have been missed all
 * last month.
 */
export function isDueOn(item: ChecklistItem, day: DayKey): boolean {
  if (!item.active) return false;

  switch (item.recurrence) {
    case 'daily':
      return true;

    case 'weekdays':
      return (item.weekdays ?? []).includes(isoWeekday(day));

    case 'interval': {
      if (!item.interval_days || !item.anchor_day) return false;
      const elapsed = daysBetween(item.anchor_day, day);
      return elapsed >= 0 && elapsed % item.interval_days === 0;
    }
  }
}

/** The items expected on a day, in display order. */
export function dueOn(items: ChecklistItem[], day: DayKey): ChecklistItem[] {
  return items.filter((i) => isDueOn(i, day)).sort((a, b) => a.sort_order - b.sort_order);
}

/* -------------------------------------------------------------- medication */

export interface RefillStatus {
  /** Doses left, or null when this item does not track them. */
  doses: number | null;
  /** Whole days of supply left at the configured daily dose. */
  daysLeft: number | null;
  /** Inside the lead time needed to actually obtain more. */
  needsRefill: boolean;
  /** Nothing left. */
  empty: boolean;
  /** One short line, stated plainly. Never a scold. */
  label: string | null;
}

/**
 * How the medication counter reads.
 *
 * The warning threshold is a LEAD TIME, not a round number: it fires when
 * there is just enough supply left to cover getting more. A warning that
 * arrives after the point where you could still act is decoration.
 *
 * The copy never implies fault. Running out is a supply-chain fact, not a
 * personal failing, and a counter that tuts at you is a counter you stop
 * looking at.
 */
export function refillStatus(item: ChecklistItem): RefillStatus {
  if (!item.tracks_doses) {
    return { doses: null, daysLeft: null, needsRefill: false, empty: false, label: null };
  }

  const doses = item.doses_remaining ?? 0;
  const perDay = Math.max(1, item.doses_per_completion);
  const daysLeft = Math.floor(doses / perDay);

  if (doses === 0) {
    return { doses, daysLeft: 0, needsRefill: true, empty: true, label: 'None left' };
  }

  const needsRefill = daysLeft <= item.refill_warning_days;

  return {
    doses,
    daysLeft,
    needsRefill,
    empty: false,
    label: needsRefill
      ? `${doses} left, ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} — time to refill`
      : `${doses} left`,
  };
}

/**
 * The last N local days, oldest first, for the back-fill strip and the
 * completion history.
 *
 * Bounded deliberately. An infinitely scrollable history of a daily checklist
 * is a record of every day you missed, which is the thing this app must not
 * become.
 */
export function recentDays(today: DayKey, count: number): DayKey[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i - (count - 1)));
}

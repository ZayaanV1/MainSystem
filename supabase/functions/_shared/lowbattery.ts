import type { ChecklistItem } from './checklist.ts';

/**
 * What survives low-battery mode.
 *
 * The rule is hiding, not reordering. A shorter list with the rest below it is
 * still the same wall of evidence, one scroll away — and knowing it is down
 * there is enough to keep it working on you. So everything not essential is
 * gone from the screen entirely until the mode is turned off.
 *
 * The counterpart matters as much: nothing is lost, nothing is marked skipped,
 * and no record is kept of what was hidden. Turning the mode off returns the
 * day exactly as it was. Low-battery mode must never generate a debt.
 */

export interface Essentials<A> {
  /** Checklist items marked non-negotiable. */
  items: ChecklistItem[];
  /**
   * One piece of work. Not a list — a list is the thing being escaped, and
   * choosing between five items is itself the task you cannot face today.
   */
  work: A | null;
  /** How much is hidden, so the mode can be honest without being specific. */
  hiddenCount: number;
}

interface WorkLike {
  status: string;
  due_at: string | null;
  effort_minutes: number | null;
}

/**
 * Picks the single piece of work to offer.
 *
 * Preference order, and the reasoning:
 *
 *   1. Something small and soon. On a bad day the win that matters is
 *      finishing anything at all, and a 20-minute task finished beats a
 *      3-hour task started.
 *   2. Failing that, whatever is most urgent.
 *
 * Deliberately NOT the most overdue thing. The most overdue item is usually
 * the one that has been avoided longest, and it is avoided for a reason —
 * offering it as today's single task on the worst day of the month is how the
 * feature would backfire.
 */
export function chooseWork<A extends WorkLike>(assignments: A[]): A | null {
  const open = assignments.filter((a) => a.status !== 'done');
  if (open.length === 0) return null;

  const scored = open.map((a) => {
    const effort = a.effort_minutes ?? 60;
    // Undated work sorts after dated work rather than first.
    const due = a.due_at ?? '9999-12-31';
    return { a, effort, due };
  });

  const small = scored.filter((s) => s.effort <= 30);
  const pool = small.length > 0 ? small : scored;

  pool.sort((x, y) => x.due.localeCompare(y.due) || x.effort - y.effort);
  return pool[0].a;
}

export function essentialsFor<A extends WorkLike>(
  items: ChecklistItem[],
  assignments: A[],
): Essentials<A> {
  const essential = items.filter((i) => i.essential);
  const work = chooseWork(assignments);

  const hiddenItems = items.length - essential.length;
  const hiddenWork = assignments.filter((a) => a.status !== 'done').length - (work ? 1 : 0);

  return { items: essential, work, hiddenCount: hiddenItems + hiddenWork };
}

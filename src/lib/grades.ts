import type { Assignment } from './planner';

/**
 * What a course is made of, and how much of it is still unmarked.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not project. There is no "you are on track for a B+", no predicted
 * final grade, no best-case/worst-case band. Every one of those invents a
 * number the institution never gave, and a planner that tells a student they
 * are heading for a 68 has made a claim it cannot support and that will be
 * remembered as if it could.
 *
 * The scope list also forbids gamification, and rule 3 forbids anything that
 * keeps score across days. A grade is a fact a marker wrote down, so recording
 * it is bookkeeping — but the moment the app starts deriving a verdict from
 * those facts it becomes a scoreboard, which is the thing that gets an app
 * closed on a bad week.
 *
 * So this is subtraction and nothing else: what is weighted, what has been
 * marked, what remains. Every figure below is a number the user could have
 * worked out on paper from data they already have.
 */

export interface CourseGrades {
  /** Weights that exist at all. Rarely 100 — most syllabi are partly unread. */
  weightKnown: number;
  /** Of that, how much has a mark recorded against it. */
  weightMarked: number;
  /**
   * Points banked, out of 100 for the whole course.
   *
   * A 30%-weighted midterm scored at 80 contributes 24. This is a real,
   * already-decided share of the final grade — not an estimate of it.
   */
  earned: number;
  /** How many weighted items are still unmarked. */
  unmarked: number;
  /** True when nothing carries a weight, so the UI can say nothing at all. */
  empty: boolean;
}

/** Two decimal places, matching the numeric(5,2) columns. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export function courseGrades(assignments: Assignment[]): CourseGrades {
  const weighted = assignments.filter(
    (a) => typeof a.weight_percent === 'number' && a.weight_percent > 0,
  );

  let weightKnown = 0;
  let weightMarked = 0;
  let earned = 0;
  let unmarked = 0;

  for (const a of weighted) {
    const w = a.weight_percent as number;
    weightKnown += w;

    if (typeof a.grade_percent === 'number') {
      weightMarked += w;
      // The share of the FINAL grade this item has already decided.
      earned += (w * a.grade_percent) / 100;
    } else {
      unmarked += 1;
    }
  }

  return {
    weightKnown: round2(weightKnown),
    weightMarked: round2(weightMarked),
    earned: round2(earned),
    unmarked,
    empty: weighted.length === 0,
  };
}

/**
 * The one sentence a course row can show.
 *
 * Returns null rather than a placeholder when there is nothing to say. A row
 * reading "0% of 0%" is worse than a row saying nothing, and most courses will
 * have no weights until a syllabus is imported.
 *
 * Note what the copy never does: it does not divide `earned` by
 * `weightMarked` to produce a running average. That number is real arithmetic
 * and it is a verdict — "you are averaging 71%" is exactly the score across
 * time that rule 3 exists to prevent, and it is at its most discouraging after
 * a single bad first assessment, which is the moment it would first appear.
 */
export function gradeSummary(g: CourseGrades): string | null {
  if (g.empty) return null;

  if (g.weightMarked === 0) {
    return `${g.weightKnown}% of the grade is on the calendar, none of it marked yet.`;
  }

  const left = round2(g.weightKnown - g.weightMarked);
  const banked = `${g.earned} of ${g.weightMarked} points banked`;

  if (left <= 0) return `${banked}. Everything on the calendar is marked.`;

  return `${banked}. ${left}% still to be marked${
    g.unmarked > 0 ? `, across ${g.unmarked} ${g.unmarked === 1 ? 'item' : 'items'}` : ''
  }.`;
}

/**
 * Sorts weighted work by what it is worth, heaviest first.
 *
 * The useful ordering when a week has more in it than fits. Unweighted work
 * sorts last rather than as zero — "no weight recorded" and "worth nothing"
 * are different facts, and treating the first as the second would bury exactly
 * the items a syllabus has not been imported for.
 */
export function byWeight(assignments: Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) => {
    const aw = typeof a.weight_percent === 'number' ? a.weight_percent : -1;
    const bw = typeof b.weight_percent === 'number' ? b.weight_percent : -1;
    return bw - aw;
  });
}

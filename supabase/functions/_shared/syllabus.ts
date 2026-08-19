/**
 * Pulling deadlines out of a syllabus.
 *
 * From the spec: "Manual entry of a semester's deadlines never gets done, and
 * an incomplete calendar is an untrusted calendar." That second half is the
 * reason this has to be careful rather than merely convenient — a syllabus
 * import that invents one date, or drops one, produces a calendar that looks
 * complete and is not, which is worse than the empty one it replaced.
 *
 * So: dates are never guessed. A syllabus that says "Week 6" without a
 * calendar date yields an item with no date rather than an item dated by
 * counting weeks from a term start the model does not know. Undated items
 * still come through — they are real work, and the app already has a place for
 * work with no date — but they arrive visibly undated.
 *
 * Everything is confirmed before it is written. Rule 6 applies here exactly as
 * it does to food.
 */

export type SyllabusKind = 'assignment' | 'exam' | 'presentation';

export interface SyllabusItem {
  title: string;
  kind: SyllabusKind;
  /** Local calendar date, or null when the syllabus did not give one. */
  due_date: string | null;
  /** 24-hour local time, or null. */
  due_time: string | null;
  /** Percentage of the final grade, when stated. */
  weight_percent: number | null;
}

export interface SyllabusResult {
  items: SyllabusItem[];
  warnings: string[];
}

export const SYLLABUS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['assignment', 'exam', 'presentation'] },
          due_date: { type: 'string', nullable: true },
          due_time: { type: 'string', nullable: true },
          weight_percent: { type: 'number', nullable: true },
        },
        required: ['title', 'kind'],
      },
    },
  },
  required: ['items'],
} as const;

export const SYLLABUS_INSTRUCTION = [
  'You extract every graded deliverable from a course syllabus: assignments,',
  'exams, quizzes, labs, projects and presentations.',
  'Give each one the title the syllabus uses.',
  'Set due_date only when the syllabus states an actual calendar date. Write it',
  'as YYYY-MM-DD. If it says only "Week 6" or "TBD", set due_date to null.',
  'Never calculate a date from a week number and never guess a year.',
  'Set due_time only when a time of day is stated, as HH:MM in 24-hour form.',
  'Set weight_percent only when a percentage of the final grade is stated.',
  'Classify an exam, midterm, final or test as exam; a presentation or demo as',
  'presentation; everything else as assignment.',
  'Do not invent deliverables. Do not merge two into one. Return only the JSON.',
].join(' ');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TITLE = 200;

/** Rejects a date that parses but is not the day it claims, e.g. 2026-02-30. */
function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/**
 * Validates an extraction.
 *
 * A bad date is discarded and the item is kept undated, rather than the item
 * being dropped. The title is the part that was actually read off the page;
 * losing a real deliverable because its date came back malformed is the
 * incomplete-calendar failure the spec warns about.
 */
export function validateSyllabus(raw: unknown, termBounds?: { from: string; to: string }): SyllabusResult {
  const root = raw as { items?: unknown };
  const list = Array.isArray(root?.items) ? root.items : [];

  const items: SyllabusItem[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    const item = entry as Record<string, unknown>;
    const title = typeof item?.title === 'string' ? item.title.trim() : '';

    if (!title || title.length > MAX_TITLE) {
      warnings.push('An entry came back with no usable title and was dropped.');
      continue;
    }

    const key = title.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) {
      warnings.push(`"${title}" appeared twice and was kept once.`);
      continue;
    }
    seen.add(key);

    const kind: SyllabusKind =
      item.kind === 'exam' || item.kind === 'presentation' ? item.kind : 'assignment';

    let due_date: string | null = null;
    if (typeof item.due_date === 'string' && item.due_date.trim()) {
      const candidate = item.due_date.trim();
      if (!isRealDate(candidate)) {
        warnings.push(`"${title}" came back with an unreadable date and is undated.`);
      } else if (termBounds && (candidate < termBounds.from || candidate > termBounds.to)) {
        // A date outside the term is nearly always a year the model guessed.
        warnings.push(`"${title}" was dated ${candidate}, outside the term, so it is undated.`);
      } else {
        due_date = candidate;
      }
    }

    let due_time: string | null = null;
    if (typeof item.due_time === 'string' && TIME.test(item.due_time.trim())) {
      due_time = item.due_time.trim();
    }

    // A time with no date cannot be stored as an instant and would be silently
    // dropped later, so it is dropped here where it can be said out loud.
    if (due_time && !due_date) {
      warnings.push(`"${title}" had a time but no date, so the time was dropped.`);
      due_time = null;
    }

    let weight_percent: number | null = null;
    if (typeof item.weight_percent === 'number' && Number.isFinite(item.weight_percent)) {
      const w = Math.round(item.weight_percent * 10) / 10;
      if (w > 0 && w <= 100) weight_percent = w;
    }

    items.push({ title, kind, due_date, due_time, weight_percent });
  }

  // Said plainly rather than shown as a silent gap, because the whole risk of
  // this feature is a calendar that looks complete and is not.
  const undated = items.filter((i) => i.due_date === null).length;
  if (undated > 0) {
    warnings.push(
      `${undated} of ${items.length} have no date in the syllabus. Give them one, or they stay undated.`,
    );
  }

  const total = items.reduce((n, i) => n + (i.weight_percent ?? 0), 0);
  if (total > 100.5) {
    warnings.push(`The stated weights add up to ${Math.round(total)}%, so at least one is wrong.`);
  }

  return { items, warnings };
}

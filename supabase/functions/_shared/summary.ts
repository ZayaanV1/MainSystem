/**
 * The summary shown when the app opens.
 *
 * Two or three sentences on what today holds, ending in one suggestion about
 * order — "worth starting the lab before the laundry". That last part is the
 * point: a list of deadlines is something the app already shows perfectly
 * well, and reading it back as prose would be a worse version of the screen
 * underneath. What a list cannot do is say which thing to touch first.
 *
 * The hard constraint is honesty about dates. This runs unattended on every
 * launch and the user is not confirming it, so the same rule as the chatbot
 * applies and applies harder: it may only describe work it was given, and it
 * may never state a deadline that was not in the data. The validation below
 * cannot check prose for truth, so it does the two things it can — it bounds
 * the length, and it refuses output that invented a due date format nobody
 * passed in.
 */

export interface SummaryItem {
  title: string;
  /** Already rendered in the user's local zone by the caller. */
  due: string | null;
  kind: 'assignment' | 'exam' | 'presentation' | 'chore';
  minutes: number | null;
}

export interface SummaryInput {
  today: string;
  /** Local wall-clock time, so "this evening" means something. */
  now: string;
  dueToday: SummaryItem[];
  dueSoon: SummaryItem[];
  overdue: SummaryItem[];
  /** Recurring things still outstanding today. */
  chores: string[];
}

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
} as const;

export const SUMMARY_INSTRUCTION = [
  'You write the two or three sentence briefing a student sees when they open',
  'their planner. Address them as "you".',
  'Say what today actually holds, then end with ONE suggestion about what to',
  'do first or in what order, phrased as a suggestion and not an instruction.',
  'Only mention work that appears in the data below. Never state a date or a',
  'time that is not there. If there is nothing due, say the day is clear and',
  'stop — do not invent something to recommend.',
  'Plain sentences, no lists, no bullet points, no headings. Sentence case.',
  'No emoji, no exclamation marks. Do not congratulate, do not mention',
  'streaks, and do not comment on how they must be feeling.',
  'Under sixty words. Return only the JSON.',
].join(' ');

const MAX_WORDS = 90;

/**
 * A fingerprint of what the summary was written from.
 *
 * The summary is rewritten when this changes and reused when it does not, so
 * it must cover everything the prose can mention and nothing it cannot. The
 * clock is excluded on purpose: opening the app an hour later is not a reason
 * to spend a model call.
 */
export function fingerprint(input: SummaryInput): string {
  const part = (items: SummaryItem[]) =>
    items.map((i) => `${i.title}|${i.due ?? ''}|${i.kind}`).join(';');

  return [
    input.today,
    part(input.dueToday),
    part(input.dueSoon),
    part(input.overdue),
    input.chores.join(';'),
  ].join('#');
}

/** True when there is genuinely nothing to write about. */
export function isEmptyDay(input: SummaryInput): boolean {
  return (
    input.dueToday.length === 0 &&
    input.dueSoon.length === 0 &&
    input.overdue.length === 0 &&
    input.chores.length === 0
  );
}

export interface SummaryResult {
  summary: string;
  warnings: string[];
}

export function validateSummary(raw: unknown, input: SummaryInput): SummaryResult {
  const text = typeof (raw as { summary?: unknown })?.summary === 'string'
    ? ((raw as { summary: string }).summary).trim()
    : '';

  const warnings: string[] = [];

  if (!text) return { summary: '', warnings: ['The model returned nothing.'] };

  // Bulleted output is a formatting failure rather than a content one, and it
  // would sit badly above a screen that is already a list. Markers are
  // stripped line by line BEFORE the lines are joined — collapsing first
  // leaves every bullet except the first stranded mid-sentence.
  const flattened = text
    .split(/[\n\r]+/)
    .map((line) => line.trim().replace(/^[-•*]\s*/, ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ');

  if (flattened.split(/\s+/).length > MAX_WORDS) {
    return {
      summary: '',
      warnings: [`The summary came back at ${flattened.split(/\s+/).length} words and was dropped.`],
    };
  }

  /*
   * A date the data never contained is the one failure that matters here,
   * because nobody confirms this text before reading it. Any ISO date in the
   * prose must be one that was passed in; anything else is invention and the
   * whole summary is dropped rather than shown with a wrong deadline in it.
   */
  const known = new Set(
    [...input.dueToday, ...input.dueSoon, ...input.overdue]
      .map((i) => i.due)
      .filter((d): d is string => Boolean(d))
      .concat(input.today),
  );

  for (const found of flattened.matchAll(/\d{4}-\d{2}-\d{2}/g)) {
    if (![...known].some((k) => k.startsWith(found[0]))) {
      return { summary: '', warnings: [`The summary cited ${found[0]}, which is not in your data.`] };
    }
  }

  return { summary: flattened, warnings };
}

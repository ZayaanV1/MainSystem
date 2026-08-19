/**
 * Turning an assignment into first moves.
 *
 * From the spec: "'Write research paper' is paralysis; 'open a doc and write
 * three possible thesis sentences' is not." The whole value is in that
 * distinction, and it is the thing a model will get wrong by default — asked
 * to break down a task it will happily return "Research the topic", "Write the
 * paper", "Proofread", which is the original problem in four pieces.
 *
 * So the instruction is specific about what a step must be, and the validation
 * rejects the failure modes rather than trusting the prompt. Nothing is
 * written without confirmation either way.
 */

export interface BreakdownStep {
  title: string;
  /** Rough minutes for this step. Used to sanity-check that it is small. */
  minutes: number;
}

export interface BreakdownResult {
  steps: BreakdownStep[];
  warnings: string[];
}

export const BREAKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          minutes: { type: 'number' },
        },
        required: ['title', 'minutes'],
      },
    },
  },
  required: ['steps'],
} as const;

export const BREAKDOWN_INSTRUCTION = [
  'You turn one piece of student work into four or five concrete first moves.',
  'Each step must be something that can be started immediately without deciding',
  'anything else first, and finished in under forty minutes.',
  'Write each step as a physical action with an object: "open the syllabus and',
  'copy the three marking criteria into a doc", not "understand the criteria".',
  'The first step must be startable in under five minutes and must not require',
  'reading anything long.',
  'Never restate the assignment title as a step. Never use the words plan,',
  'research, review, study, prepare, understand or finalise as the verb.',
  'Return only the JSON.',
].join(' ');

/** Vague verbs. A step that opens with one of these is the paralysis again. */
const VAGUE = /^(plan|research|review|study|prepare|plan out|plan for|understand|plan to|finalis|finaliz|work on|start|begin|continue|think about|look at|go over|familiaris|familiariz)/i;

const MAX_TITLE = 120;
const MAX_MINUTES = 40;

/** Loose similarity, for catching a step that is just the title again. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Validates a breakdown.
 *
 * Bad steps are dropped rather than rewritten, and the drop is reported. A
 * heuristic rewrite of "Research the topic" into something concrete would be
 * inventing the very content the model was asked for.
 */
export function validateBreakdown(raw: unknown, assignmentTitle: string): BreakdownResult {
  const root = raw as { steps?: unknown };
  const list = Array.isArray(root?.steps) ? root.steps : [];

  const steps: BreakdownStep[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const titleKey = normalise(assignmentTitle);

  for (const entry of list) {
    const item = entry as { title?: unknown; minutes?: unknown };
    const title = typeof item?.title === 'string' ? item.title.trim() : '';

    if (!title) {
      warnings.push('A step came back empty and was dropped.');
      continue;
    }

    if (title.length > MAX_TITLE) {
      warnings.push(`A step was too long to be a first move and was dropped: "${title.slice(0, 50)}…"`);
      continue;
    }

    const key = normalise(title);

    if (key === titleKey) {
      warnings.push('A step was just the assignment title again and was dropped.');
      continue;
    }

    if (seen.has(key)) {
      warnings.push(`"${title}" came back twice and was kept once.`);
      continue;
    }

    if (VAGUE.test(title)) {
      warnings.push(`"${title}" is the kind of step that causes the paralysis, so it was dropped.`);
      continue;
    }

    const rawMinutes = typeof item?.minutes === 'number' && Number.isFinite(item.minutes)
      ? item.minutes
      : null;

    // A step estimated at over forty minutes is not a first move. It is kept,
    // because the wording may still be useful, but the estimate is capped and
    // the disagreement is said out loud rather than hidden.
    let minutes = rawMinutes === null ? 15 : Math.round(rawMinutes);
    if (minutes > MAX_MINUTES) {
      warnings.push(`"${title}" was estimated at ${minutes} minutes, which is not a first move.`);
      minutes = MAX_MINUTES;
    }
    if (minutes < 1) minutes = 5;

    seen.add(key);
    steps.push({ title, minutes });
  }

  // More than six is a plan, not a first move, and a list long enough to scan
  // is a list long enough to avoid.
  if (steps.length > 6) {
    warnings.push(`${steps.length} steps came back; the first six were kept.`);
    steps.length = 6;
  }

  return { steps, warnings };
}

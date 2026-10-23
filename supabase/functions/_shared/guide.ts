/**
 * A guide to an assignment, read from its brief.
 *
 * The brief is the PDF the instructor handed out. The guide answers the
 * question a person actually has on opening it: what exactly am I being asked
 * for, and where do I start on each part?
 *
 * WHAT IT IS NOT. It does not solve anything. A guide that hands back finished
 * answers does the work it was meant to help with, and a student who submits
 * that has learned nothing and carries the risk of it. So the instruction asks
 * for the method, the concepts each part leans on and the first move, and the
 * validator drops any part that reads as a bare answer.
 *
 * Like every model output here it is a proposal. The app shows it and saves it
 * only when the person says so.
 */

export interface GuidePart {
  /** "Question 2", "Part B", "The essay" — as the brief names it. */
  label: string;
  /** How to approach it, in a few sentences. */
  approach: string;
  /** What the person needs to know or have to hand to do it. */
  concepts: string[];
}

export interface Guide {
  overview: string;
  /** What the brief requires of the submission, one line each. */
  requirements: string[];
  parts: GuidePart[];
  pitfalls: string[];
  /** Things the brief leaves open, worth asking the instructor. */
  ask: string[];
}

export interface GuideResult {
  guide: Guide;
  warnings: string[];
}

export const GUIDE_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    requirements: { type: 'array', items: { type: 'string' } },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          approach: { type: 'string' },
          concepts: { type: 'array', items: { type: 'string' } },
        },
        required: ['label', 'approach', 'concepts'],
      },
    },
    pitfalls: { type: 'array', items: { type: 'string' } },
    ask: { type: 'array', items: { type: 'string' } },
  },
  required: ['overview', 'requirements', 'parts', 'pitfalls', 'ask'],
} as const;

export const GUIDE_INSTRUCTION = [
  'You write a study guide for one university assignment from the brief attached.',
  'Read the whole document. Say in two or three sentences what the assignment is',
  'and what a finished submission looks like.',
  'List what the brief requires of the submission (format, length, files, marking',
  'criteria, anything that loses marks if missed), one short line each, using the',
  'brief\'s own numbers and words.',
  'Then give one part for each question, section or deliverable, labelled the',
  'way the brief labels it. For each, explain HOW to approach it: the method to',
  'use, the first thing to write or compute, and the concepts or course material',
  'it leans on. Do not give final answers, numerical results, finished',
  'paragraphs or code that completes the task. Show the route, not the',
  'destination.',
  'Add the common ways students lose marks on work like this, and anything the',
  'brief leaves unclear that is worth asking the instructor.',
  'Use only what the document says. If the document is not an assignment brief,',
  'or cannot be read, return an empty parts list and say so in the overview.',
  'Return only the JSON.',
].join(' ');

const MAX_OVERVIEW = 700;
const MAX_LINE = 240;
const MAX_APPROACH = 900;
const MAX_LABEL = 80;
const MAX_PARTS = 14;
const MAX_LINES = 10;

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function lines(raw: unknown, max: number, cap: number, noun: string, warnings: string[]): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    const text = clean(entry, max);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length >= cap) {
      warnings.push(`Some ${noun} were left out to keep the guide short.`);
      break;
    }
    out.push(text);
  }
  return out;
}

/**
 * Shapes whatever came back into a guide, and says what was dropped.
 *
 * A part with no approach is dropped, and so is one whose "approach" is a
 * bare result (a number, or "the answer is"), because a guide that contains
 * the answers is the failure the instruction forbids and the prompt alone is
 * not a guarantee.
 */
export function validateGuide(raw: unknown): GuideResult {
  const root = (raw ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];

  const parts: GuidePart[] = [];
  const list = Array.isArray(root.parts) ? root.parts : [];
  for (const entry of list) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const label = clean(item.label, MAX_LABEL);
    const approach = clean(item.approach, MAX_APPROACH);
    if (!label || !approach) {
      warnings.push('A part came back without a label or an approach and was dropped.');
      continue;
    }
    if (/^(the )?(final )?(answer|result|solution) (is|=)\b/i.test(approach) || /^[\d\s.,=+\-−×x/^()%$]+$/.test(approach)) {
      warnings.push(`"${label}" read as an answer rather than a method and was dropped.`);
      continue;
    }
    if (parts.length >= MAX_PARTS) {
      warnings.push('Some parts were left out to keep the guide short.');
      break;
    }
    parts.push({ label, approach, concepts: lines(item.concepts, 120, 6, 'concepts', warnings) });
  }

  return {
    guide: {
      overview: clean(root.overview, MAX_OVERVIEW),
      requirements: lines(root.requirements, MAX_LINE, MAX_LINES, 'requirements', warnings),
      parts,
      pitfalls: lines(root.pitfalls, MAX_LINE, 6, 'pitfalls', warnings),
      ask: lines(root.ask, MAX_LINE, 5, 'questions', warnings),
    },
    warnings,
  };
}

/** The guide as plain Markdown, for download and for pasting into notes. */
export function guideToMarkdown(title: string, guide: Guide): string {
  const out: string[] = [`# Guide: ${title}`, ''];
  if (guide.overview) out.push(guide.overview, '');
  if (guide.requirements.length) {
    out.push('## What the brief requires', '', ...guide.requirements.map((r) => `- ${r}`), '');
  }
  if (guide.parts.length) {
    out.push('## How to approach each part', '');
    for (const p of guide.parts) {
      out.push(`### ${p.label}`, '', p.approach, '');
      if (p.concepts.length) out.push(`Needs: ${p.concepts.join('; ')}`, '');
    }
  }
  if (guide.pitfalls.length) {
    out.push('## Where marks are lost', '', ...guide.pitfalls.map((r) => `- ${r}`), '');
  }
  if (guide.ask.length) {
    out.push('## Worth asking', '', ...guide.ask.map((r) => `- ${r}`), '');
  }
  return out.join('\n').trimEnd() + '\n';
}

/** True when the saved value looks like a guide this version can show. */
export function isGuide(value: unknown): value is Guide {
  const g = value as Guide | null;
  return Boolean(
    g &&
      typeof g.overview === 'string' &&
      Array.isArray(g.requirements) &&
      Array.isArray(g.parts) &&
      Array.isArray(g.pitfalls) &&
      Array.isArray(g.ask),
  );
}

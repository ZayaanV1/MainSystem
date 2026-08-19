/**
 * The chatbot's contract.
 *
 * From the spec: "It must say plainly when it doesn't know something or can't
 * do something, rather than inventing an answer. A confidently wrong deadline
 * is worse than no chatbot."
 *
 * That line shapes everything here, because it cannot be achieved by asking
 * the model nicely. Three mechanisms carry it instead:
 *
 *   The model is given the user's actual rows and told to answer only from
 *   them. Nothing is retrieved on its behalf mid-conversation, so there is no
 *   path by which it can be confident about data it was never shown.
 *
 *   It must name the ids it used. Any id that is not in the context it was
 *   given is a fabrication, and it is dropped and counted.
 *
 *   The app renders those referenced rows from the DATABASE, not from the
 *   model's prose. So even when a sentence is wrong, the dates on screen are
 *   real ones. This is the mechanism that actually stops a confidently wrong
 *   deadline, and it is the reason `referenced` is required rather than nice.
 *
 * Actions are proposals. Nothing is written until it is confirmed, same as
 * food, syllabus dates and everything else.
 */

export type ChatActionKind =
  | 'add_assignment'
  | 'complete_checklist_item'
  | 'log_saved_meal'
  | 'set_weight';

export interface ChatAction {
  kind: ChatActionKind;
  /** Free-form per kind; validated below before it can be offered. */
  [key: string]: unknown;
}

export interface ChatReply {
  reply: string;
  action: ChatAction | null;
  referenced: string[];
  warnings: string[];
}

export const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    referenced: { type: 'array', items: { type: 'string' } },
    action: {
      type: 'object',
      nullable: true,
      properties: {
        kind: {
          type: 'string',
          enum: ['add_assignment', 'complete_checklist_item', 'log_saved_meal', 'set_weight'],
        },
        title: { type: 'string', nullable: true },
        due_date: { type: 'string', nullable: true },
        due_time: { type: 'string', nullable: true },
        item_id: { type: 'string', nullable: true },
        meal_id: { type: 'string', nullable: true },
        portion: { type: 'number', nullable: true },
        kg: { type: 'number', nullable: true },
      },
      required: ['kind'],
    },
  },
  required: ['reply', 'referenced'],
} as const;

export const CHAT_INSTRUCTION = [
  'You are a planner assistant for one person. You are given their real data',
  'below. Answer only from that data.',
  'If the answer is not in the data, say so plainly in one sentence. Never',
  'guess a date, a deadline, a macro number or a dose. A wrong deadline stated',
  'confidently is worse than no answer.',
  'List in "referenced" the id of every item your answer relies on, copied',
  'exactly from the data. Never invent an id.',
  'Keep replies short and plain. Sentence case, no emoji, no exclamation marks.',
  'Do not congratulate them on streaks or comment on how many days in a row',
  'anything has happened.',
  'Set "action" only when they clearly asked you to change something. An',
  'action is a proposal they will confirm, so describe it in the reply too.',
  'Use add_assignment with a title and optional due_date (YYYY-MM-DD) and',
  'due_time (HH:MM). Use complete_checklist_item with the item_id. Use',
  'log_saved_meal with the meal_id and optional portion. Use set_weight with',
  'kg. For anything else, set action to null and say what you cannot do.',
  'Return only the JSON.',
].join(' ');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_REPLY = 2_000;

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Validates a reply against the ids the model was actually given.
 *
 * `knownIds` is every id present in the context. An action or a reference
 * pointing outside that set did not come from the data, and is refused rather
 * than passed to a confirmation screen where it would look legitimate.
 */
export function validateChat(raw: unknown, knownIds: Set<string>): ChatReply {
  const root = raw as { reply?: unknown; action?: unknown; referenced?: unknown };

  const warnings: string[] = [];

  const reply =
    typeof root?.reply === 'string' && root.reply.trim()
      ? root.reply.trim().slice(0, MAX_REPLY)
      : 'I could not put together an answer to that.';

  const referenced: string[] = [];
  if (Array.isArray(root?.referenced)) {
    for (const id of root.referenced) {
      if (typeof id !== 'string') continue;
      if (knownIds.has(id)) referenced.push(id);
      else warnings.push('The answer referred to something not in your data, and it was dropped.');
    }
  }

  const action = validateAction(root?.action, knownIds, warnings);

  return { reply, action, referenced: [...new Set(referenced)], warnings };
}

function validateAction(
  raw: unknown,
  knownIds: Set<string>,
  warnings: string[],
): ChatAction | null {
  if (!raw || typeof raw !== 'object') return null;

  const a = raw as Record<string, unknown>;
  const kind = a.kind;

  const refuse = (why: string): null => {
    warnings.push(why);
    return null;
  };

  if (kind === 'add_assignment') {
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    if (!title) return refuse('An assignment was proposed with no title, so it was dropped.');

    let due_date: string | null = null;
    if (typeof a.due_date === 'string' && a.due_date.trim()) {
      if (isRealDate(a.due_date.trim())) due_date = a.due_date.trim();
      else warnings.push('A proposed due date was unreadable, so it was left off.');
    }

    let due_time: string | null = null;
    if (typeof a.due_time === 'string' && TIME.test(a.due_time.trim())) due_time = a.due_time.trim();
    // A time with no date cannot be stored, so it goes where it can be said.
    if (due_time && !due_date) {
      warnings.push('A proposed time had no date, so the time was left off.');
      due_time = null;
    }

    return { kind, title: title.slice(0, 300), due_date, due_time };
  }

  if (kind === 'complete_checklist_item') {
    const id = typeof a.item_id === 'string' ? a.item_id : '';
    if (!knownIds.has(id)) {
      return refuse('A checklist item was proposed that is not on your list, so it was dropped.');
    }
    return { kind, item_id: id };
  }

  if (kind === 'log_saved_meal') {
    const id = typeof a.meal_id === 'string' ? a.meal_id : '';
    if (!knownIds.has(id)) {
      return refuse('A saved meal was proposed that you do not have, so it was dropped.');
    }

    const raw_portion = typeof a.portion === 'number' && Number.isFinite(a.portion) ? a.portion : 1;
    // The portions the food screen can actually log. A proposal of 0.73 would
    // be unconfirmable, which is worse than a rounded one.
    const portion = [0.5, 1, 1.5, 2].reduce((best, p) =>
      Math.abs(p - raw_portion) < Math.abs(best - raw_portion) ? p : best,
    );

    return { kind, meal_id: id, portion };
  }

  if (kind === 'set_weight') {
    const kg = typeof a.kg === 'number' && Number.isFinite(a.kg) ? a.kg : null;
    if (kg === null || kg <= 0 || kg >= 500) {
      return refuse('A weight was proposed that is not a plausible number, so it was dropped.');
    }
    return { kind, kg: Math.round(kg * 10) / 10 };
  }

  if (kind !== undefined) {
    return refuse('Something was proposed that this app cannot do, so it was dropped.');
  }

  return null;
}

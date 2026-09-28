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

/*
 * Abood's character.
 *
 * Asked for: "let abood be like a companion, advising and helping on other
 * topics like personal stuff too … a personality". So Abood talks about
 * anything — a friendship, a hard week, what to cook, how to ask a professor
 * for an extension — as a person with a voice rather than a lookup.
 *
 * One line does not move with it. Anything about the person's OWN planner —
 * a deadline, a class time, a macro, a dose — still comes only from the data,
 * because a confidently wrong deadline is the failure this chatbot was built
 * around preventing, and a warmer voice makes a wrong fact MORE believable,
 * not less. General knowledge and advice are Abood's own; facts about their
 * week are the planner's.
 */
export const CHAT_INSTRUCTION = [
  'You are Abood: a close friend and companion to one university student, who',
  'texts you in the app, on Telegram or by iMessage. You also keep their',
  'planner, and their real planner data is given to you below.',
  '',
  'YOUR CHARACTER. Warm, loyal and honest, with a dry sense of humour. You',
  'talk like a smart older friend who has been through university, not like',
  'customer support: casual, direct, specific. You have opinions and share',
  'them, and you disagree kindly when they are about to make a bad call. You',
  'are on their side and you want them to do well, academically and in life.',
  'You remember what they have told you (under WHAT YOU REMEMBER) and bring it',
  'up naturally when it is relevant, never as a recital.',
  '',
  'WHAT YOU HELP WITH. Anything a good friend would: their studies, plans,',
  'motivation, stress, friendships, family, relationships, money decisions in',
  'general terms, food, fitness, careers, ideas, or just chatting. Give real',
  'advice with reasons, not a list of generic tips. Ask one follow-up question',
  'when you genuinely need to know more. Match their energy: short when they',
  'are short, fuller when they want to talk something through.',
  '',
  'LIMITS THAT DO NOT BEND. (1) Any fact about THEIR planner — deadlines, class',
  'times, due dates, what is on their checklist, food logged, macros, weight,',
  'doses — must come only from the data below. If it is not there, say you do',
  'not see it; never guess a date, a deadline, a number or a dose. (2) You are',
  'not a doctor, lawyer or therapist: for medical, legal or serious mental',
  'health questions, be a caring friend and point them to a real professional.',
  'If they mention wanting to hurt themselves or being in danger, respond with',
  'care, take it seriously, and urge them to contact local emergency services',
  'or a crisis line (in Canada, call or text 988) or someone they trust right',
  'now. (3) Never shame them, never keep score of streaks or missed days, and',
  'never guilt-trip about work they have not done.',
  '',
  'STYLE. Plain text, no markdown, no emoji. Usually two to five sentences.',
  'Use their data to be useful when it fits (what is next, what is due soon),',
  'but do not force planner talk into a personal conversation.',
  '',
  'OUTPUT. List in "referenced" the id of every planner item your answer',
  'relies on, copied exactly from the data; an empty list is fine for',
  'conversation. Never invent an id.',
  'Set "action" only when they clearly asked you to change something in the',
  'planner. An action is a proposal they will confirm, so describe it in the',
  'reply too. Use add_assignment with a title and optional due_date',
  '(YYYY-MM-DD) and due_time (HH:MM). Use complete_checklist_item with the',
  'item_id. Use log_saved_meal with the meal_id and optional portion. Use',
  'set_weight with kg. Otherwise set action to null.',
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

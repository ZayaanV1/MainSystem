import { addDays, daysBetween, localDayKey, localHourMinute, type DayKey } from './time.ts';

/**
 * The slice of the user's own data the chatbot is allowed to see.
 *
 * Scoping is a correctness feature before it is a privacy one. The model can
 * only be confidently wrong about data it was given, so the smaller and more
 * exact this is, the less there is to be wrong about — and everything omitted
 * becomes an honest "I don't have that" rather than a guess.
 *
 * It is also a cost feature: this is rebuilt on every message, and a context
 * that grew with the food log would eventually cost more than the answer.
 * Everything here is bounded — open work, the next month of events, today's
 * food, the last few weigh-ins.
 *
 * Ids are included on purpose. They are what the reply cites, what the app
 * checks a proposed action against, and what the UI re-reads from the database
 * so a wrong sentence cannot put a wrong date on screen.
 */

export interface ContextInput {
  today: DayKey;
  now: string;
  /**
   * The account's zone. Required, with no default, deliberately — a default
   * here is what produced the bug: every stamp silently resolved to Toronto
   * while the prompt asserted the dates were the user's own local time.
   */
  timezone: string;
  assignments: {
    id: string;
    title: string;
    due_at: string | null;
    due_has_time: boolean;
    status: string;
    effort_minutes: number | null;
    course?: string | null;
    /** When it was added. Lets "what have I been putting off" be answerable. */
    created_at?: string | null;
  }[];
  events: { id: string; title: string; kind: string; starts_at: string; all_day: boolean; course?: string | null }[];
  checklist: { id: string; title: string; done_today: boolean; doses_remaining: number | null }[];
  food: {
    totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
    targets: { calories: [number, number]; protein: [number, number]; carbs: [number, number]; fat: [number, number] } | null;
    items: { name: string; calories: number; protein_g: number }[];
  };
  savedMeals: { id: string; name: string; calories: number; protein_g: number }[];
  weights: { local_day: DayKey; kg: number }[];
}

export interface BuiltContext {
  text: string;
  /** Every id the model may legitimately cite or act on. */
  knownIds: Set<string>;
  /**
   * Short label -> real id, when short labels were used. The model sees and
   * returns labels; they are translated back before anything is stored or
   * acted on. Absent when real ids were used.
   */
  aliases?: Map<string, string>;
}

/** Which parts of the planner a message needs. */
export type Scope = 'work' | 'food' | 'checklist';

export interface BuildOptions {
  /**
   * The sections to include. Undefined means all of them. An empty set means
   * a SNAPSHOT only: the time, and the next few things coming up.
   */
  scopes?: Set<Scope>;
  /**
   * Label items w1, e1, c1, m1 instead of their 36-character ids. A uuid
   * costs a dozen tokens and there can be seventy of them in one prompt; the
   * labels cost two, and are translated back afterwards.
   */
  shortIds?: boolean;
  /** How many days of events to include. Defaults to all given. */
  eventDays?: number;
}

const n = (v: number) => Math.round(v * 10) / 10;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * An instant, rendered in the user's local time.
 *
 * Every timestamp in the database is UTC. Slicing the ISO string is the
 * obvious thing and it is wrong: an assignment stored at 2026-08-21T03:59Z is
 * due Thursday 23:59 in Toronto, and reporting it as "2026-08-21 at 03:59"
 * moves a deadline a day later. That is precisely the confidently wrong
 * deadline the spec says is worse than no chatbot, and it got past a first
 * live test looking entirely plausible.
 */
function localStamp(iso: string, withTime: boolean, tz: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return 'unknown time';

  /*
   * The zone is a required argument, not a default. This function already had
   * the comment above explaining the UTC-read-as-local bug and it still called
   * localDayKey(instant) with no zone — which falls back to the module's
   * America/Toronto constant. So the fix converted UTC to local correctly and
   * then converted it to the WRONG local for every account outside Toronto,
   * while line 88 of this file told the model the dates were already the
   * user's own. In Sydney that is a fourteen-hour error, which crosses the day
   * boundary and reproduces exactly the bug this comment warns about.
   */
  const day = localDayKey(instant, tz);
  /*
   * The weekday is written out, never left to the model. Given bare dates it
   * worked weekdays out itself and got them wrong — "Assignment 2, due Sun
   * Oct 2" for a Friday — which is a confidently wrong deadline in all but
   * name. A day key is a calendar date, so noon UTC names its weekday in
   * every zone.
   */
  const weekday = WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
  if (!withTime) return `${weekday} ${day}`;

  const { hour, minute } = localHourMinute(instant, tz);
  return `${weekday} ${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Formats the context as plain lines rather than JSON.
 *
 * Two reasons. It is markedly cheaper per row, which matters when this is
 * rebuilt on every message against a shared free-tier quota. And a model that
 * is shown JSON tends to answer in the shape of the JSON, which is the wrong
 * register for "what's due this week".
 */
export function buildContext(input: ContextInput, opts: BuildOptions = {}): BuiltContext {
  const knownIds = new Set<string>();
  const lines: string[] = [];
  const aliases = opts.shortIds ? new Map<string, string>() : undefined;
  const counters: Record<string, number> = {};
  const label = (id: string, prefix: string): string => {
    if (!aliases) {
      knownIds.add(id);
      return id;
    }
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    const short = `${prefix}${counters[prefix]}`;
    aliases.set(short, id);
    knownIds.add(short);
    return short;
  };
  const want = (scope: Scope) => !opts.scopes || opts.scopes.has(scope);
  const lastDay = opts.eventDays !== undefined ? addDays(input.today, opts.eventDays) : null;
  const events = lastDay
    ? input.events.filter((e) => localDayKey(new Date(e.starts_at), input.timezone) <= lastDay)
    : input.events;

  lines.push(
    `Today is ${WEEKDAYS[new Date(`${input.today}T12:00:00Z`).getUTCDay()]} ${input.today}. The current local time is ${input.now}.`,
  );
  lines.push('All dates below are already in the user\'s local time.');
  lines.push('');

  if (opts.scopes && opts.scopes.size === 0) {
    /*
     * A snapshot, for a message that is not about the planner. Enough for a
     * friend to say "you have the lab at 2:45" in passing, and a fraction of
     * the full context. If the message turns out to need more, the model says
     * so (needs_planner) and it is asked again with everything.
     */
    lines.push('PLANNER SNAPSHOT (only the next few items; the full planner is not shown)');
    const now = Date.now();
    const soon = input.events
      .filter((e) => !e.all_day && Date.parse(e.starts_at) >= now)
      .slice(0, 3);
    for (const e of soon) {
      lines.push(`  [${label(e.id, 'e')}] ${e.title} — ${localStamp(e.starts_at, true, input.timezone)}${e.course ? `, course ${e.course}` : ''}`);
    }
    const due = input.assignments.filter((a) => a.due_at).slice(0, 3);
    for (const a of due) {
      lines.push(`  [${label(a.id, 'w')}] ${a.title} — due ${localStamp(a.due_at!, a.due_has_time, input.timezone)}${a.course ? `, course ${a.course}` : ''}`);
    }
    if (soon.length + due.length === 0) lines.push('  (nothing coming up)');
    return { text: lines.join('\n'), knownIds, aliases };
  }

  if (want('work')) {
  lines.push('OPEN WORK');
  if (input.assignments.length === 0) {
    lines.push('  (nothing open)');
  } else {
    for (const a of input.assignments) {
      const id = label(a.id, 'w');
      const due = a.due_at ? `due ${localStamp(a.due_at, a.due_has_time, input.timezone)}` : 'no date';
      // How long it has been sitting there. "What have I been putting off" is
      // a question the spec names explicitly, and without this the only
      // honest answer is that the data does not say — which is true, and
      // useless. Age is a fair reading of it and is a real number, unlike
      // anything the model could infer from a title.
      const age = a.created_at ? daysBetween(localDayKey(new Date(a.created_at)), input.today) : null;

      const bits = [
        a.course ? `course ${a.course}` : '',
        a.effort_minutes ? `${a.effort_minutes} min of work` : '',
        a.status !== 'todo' ? a.status : '',
        age !== null && age >= 1 ? `on the list ${age} ${age === 1 ? 'day' : 'days'}` : '',
      ].filter(Boolean);
      lines.push(`  [${id}] ${a.title} — ${due}${bits.length ? `, ${bits.join(', ')}` : ''}`);
    }
  }
  lines.push('');

  lines.push(lastDay ? `UPCOMING EVENTS (through ${lastDay})` : 'UPCOMING EVENTS');
  if (events.length === 0) {
    lines.push(lastDay ? '  (none)' : '  (none in the next month)');
  } else {
    for (const e of events) {
      const id = label(e.id, 'e');
      const when = localStamp(e.starts_at, !e.all_day, input.timezone);
      lines.push(`  [${id}] ${e.title} — ${e.kind}, ${when}${e.course ? `, course ${e.course}` : ''}`);
    }
  }
  lines.push('');

  }

  if (want('checklist')) {
  lines.push('DAILY CHECKLIST, TODAY');
  if (input.checklist.length === 0) {
    lines.push('  (nothing due today)');
  } else {
    for (const c of input.checklist) {
      const id = label(c.id, 'c');
      const doses = c.doses_remaining === null ? '' : `, ${c.doses_remaining} doses left`;
      lines.push(`  [${id}] ${c.title} — ${c.done_today ? 'done today' : 'not done today'}${doses}`);
    }
  }
  lines.push('');

  }

  if (want('food')) {
  lines.push('FOOD TODAY');
  const t = input.food.totals;
  lines.push(`  eaten so far: ${n(t.calories)} kcal, protein ${n(t.protein_g)} g, carbs ${n(t.carbs_g)} g, fat ${n(t.fat_g)} g`);
  if (input.food.targets) {
    const g = input.food.targets;
    lines.push(`  targets: ${g.calories[0]}-${g.calories[1]} kcal, protein ${g.protein[0]}-${g.protein[1]} g, carbs ${g.carbs[0]}-${g.carbs[1]} g, fat ${g.fat[0]}-${g.fat[1]} g`);
    // Precomputed so the model never has to do arithmetic to answer "how much
    // protein have I got left", which is the question it will be asked most.
    lines.push(
      `  left to reach the bottom of each range: ${Math.max(0, n(g.calories[0] - t.calories))} kcal, ` +
        `protein ${Math.max(0, n(g.protein[0] - t.protein_g))} g, ` +
        `carbs ${Math.max(0, n(g.carbs[0] - t.carbs_g))} g, ` +
        `fat ${Math.max(0, n(g.fat[0] - t.fat_g))} g`,
    );
  } else {
    lines.push('  targets: none set');
  }
  for (const i of input.food.items) {
    lines.push(`  - ${i.name}: ${n(i.calories)} kcal, ${n(i.protein_g)} g protein`);
  }
  lines.push('');

  lines.push('SAVED MEALS');
  if (input.savedMeals.length === 0) {
    lines.push('  (none saved)');
  } else {
    for (const m of input.savedMeals) {
      const id = label(m.id, 'm');
      lines.push(`  [${id}] ${m.name} — ${n(m.calories)} kcal, ${n(m.protein_g)} g protein per portion`);
    }
  }
  lines.push('');

  lines.push('RECENT WEIGH-INS');
  if (input.weights.length === 0) {
    lines.push('  (none recorded)');
  } else {
    for (const w of input.weights) lines.push(`  ${w.local_day}: ${n(w.kg)} kg`);
  }
  }

  return { text: lines.join('\n'), knownIds, aliases };
}

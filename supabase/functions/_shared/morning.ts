import { localHourMinute } from './time.ts';
import { readTitle } from './title.ts';

/**
 * The morning text: "morning bro, hope you got some solid rest last night /
 * saw travel at 10:00, then COEN 212 at 11:45, MATH 205 at 1:15, gym at
 * 5:00, and assignment 2 due at 11:59pm / lowk a full campus run, just take
 * it block by block and lmk if you need anything".
 *
 * Asked for by name, from the previous companion bot's history: the same
 * shape every morning is the point — it is familiar. The model words it; the
 * schedule is built here, from the calendar, because a morning text that
 * drops a class or moves a deadline is the one mistake a planner's first
 * message of the day cannot make. The reply is then checked against the
 * times this module produced, and a reply naming any other time is not sent.
 */

export interface MorningEvent {
  title: string;
  starts_at: string;
  all_day: boolean;
}

export interface MorningWork {
  title: string;
  due_at: string;
  due_has_time: boolean;
  course: string | null;
}

/** "10:25", "1:15" — how a friend writes a time of day, no am or pm. */
export function clock(instant: Date, tz: string): string {
  const { hour, minute } = localHourMinute(instant, tz);
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')}`;
}

/** A deadline keeps its am/pm: "11:59pm" is the one time that must not be misread. */
function dueClock(instant: Date, tz: string): string {
  const { hour } = localHourMinute(instant, tz);
  return `${clock(instant, tz)}${hour < 12 ? 'am' : 'pm'}`;
}

/** A class as a person says it: "COEN 231 tutorial", room kept. */
function eventName(title: string): { name: string; room: string | null } {
  const t = readTitle(title);
  return t.type && t.code
    ? { name: `${t.code} ${t.type.toLowerCase()}`, room: t.room }
    : { name: title.trim(), room: null };
}

export interface Morning {
  /** One line per item, in time order, for the model to word. */
  lines: string[];
  /** Every time the text may mention. */
  times: Set<string>;
  shape: 'clear' | 'light' | 'busy' | 'packed';
}

export function morningSchedule(events: MorningEvent[], work: MorningWork[], tz: string): Morning {
  const items: { at: number; line: string }[] = [];
  const times = new Set<string>();

  for (const e of events) {
    const { name, room } = eventName(e.title);
    if (e.all_day) {
      items.push({ at: -1, line: `all day: ${name}` });
      continue;
    }
    const at = new Date(e.starts_at);
    const c = clock(at, tz);
    times.add(c);
    items.push({ at: at.getTime(), line: `${c} ${name}${room ? ` (room ${room})` : ''}` });
  }

  for (const w of work) {
    const at = new Date(w.due_at);
    const title = w.course && !w.title.toUpperCase().includes(w.course.toUpperCase()) ? `${w.title} (${w.course})` : w.title;
    if (!w.due_has_time) {
      items.push({ at: Number.MAX_SAFE_INTEGER, line: `due today: ${title}` });
      continue;
    }
    const c = dueClock(at, tz);
    times.add(c);
    times.add(clock(at, tz));
    items.push({ at: at.getTime(), line: `due at ${c}: ${title}` });
  }

  items.sort((a, b) => a.at - b.at);
  const n = items.length;
  return {
    lines: items.map((i) => i.line),
    times,
    shape: n <= 1 ? 'clear' : n <= 3 ? 'light' : n <= 5 ? 'busy' : 'packed',
  };
}

/**
 * Times in a written morning text that the schedule did not give it. Any at
 * all and the text is not sent: a morning run-down with one invented time
 * reads exactly as trustworthy as a correct one.
 */
export function strayTimes(texts: string[], allowed: Set<string>): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const m of t.toLowerCase().matchAll(/\b(\d{1,2}:\d{2})\s?(am|pm|a\.m\.|p\.m\.)?/g)) {
      const bare = m[1].replace(/^0(\d)/, '$1');
      const suffix = m[2] ? m[2].replace(/\./g, '') : '';
      if (!allowed.has(bare + suffix) && !allowed.has(bare)) out.push(m[0]);
    }
  }
  return out;
}

/**
 * The same text without a model, in the same shape: used when the model is
 * unavailable or wrote a time it was not given. Plain on purpose — the voice
 * is the model's job, and this only has to be right.
 */
export function fallbackMorning(m: Morning, weekday: string, bro: boolean): string[] {
  const hi = bro ? 'morning bro, hope you got some solid rest last night' : 'morning, hope you slept alright';
  const day = weekday.toLowerCase();
  if (!m.lines.length) return [hi, `${day} looks wide open, nothing on the calendar`, 'take it easy today, lmk if you need anything'];
  const list = m.lines.map((l) => l.replace(/ \(room [^)]+\)$/, '')).join(', ');
  const send =
    m.shape === 'packed' || m.shape === 'busy'
      ? 'full day, just take it one block at a time and lmk if you need anything'
      : 'lmk if you need anything today';
  return [hi, `today: ${list}`, send];
}

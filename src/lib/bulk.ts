import { addDays, localDayKey, todayKey, wallClockToUTC, type DayKey } from './time';

/**
 * Bulk deadline entry.
 *
 * Pulled forward from its natural position in the plan because term starts in
 * about three weeks and manual entry of a semester's deadlines never gets
 * done. An incomplete calendar is an untrusted calendar, and an untrusted
 * calendar is one you stop opening.
 *
 * This parses pasted lines from a syllabus, a course page, or an email. It is
 * deliberately forgiving about order and punctuation, and deliberately loud
 * about anything it had to guess: every row reports what it understood and
 * what it did not, and nothing reaches the database until the parse has been
 * shown and confirmed.
 *
 * It never throws. A line it cannot read comes back marked unusable rather
 * than taking the rest of the paste down with it.
 */

export type RowKind = 'assignment' | 'event';
export type EventKind = 'exam' | 'lab' | 'presentation' | 'other';

export interface ParsedRow {
  /** The original line, always kept so the preview can show what was typed. */
  raw: string;
  title: string;
  kind: RowKind;
  eventKind: EventKind;
  courseId: string | null;
  dueDay: DayKey | null;
  /** Local wall-clock time, 'HH:MM'. Null means the whole day. */
  dueTime: string | null;
  effortMinutes: number | null;
  /** Things the parser guessed at or could not read. Shown in the preview. */
  warnings: string[];
  /** False when there is not even a usable title. */
  usable: boolean;
}

export interface CourseRef {
  id: string;
  name: string;
  code: string | null;
}

const MONTHS = [
  ['jan', 'january'],
  ['feb', 'february'],
  ['mar', 'march'],
  ['apr', 'april'],
  ['may'],
  ['jun', 'june'],
  ['jul', 'july'],
  ['aug', 'august'],
  ['sep', 'sept', 'september'],
  ['oct', 'october'],
  ['nov', 'november'],
  ['dec', 'december'],
];

function monthFromWord(word: string): number | null {
  const w = word.toLowerCase().replace(/\./g, '');
  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].some((m) => w === m || (w.length >= 3 && m.startsWith(w)))) return i + 1;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Chooses the year for a date given without one.
 *
 * A syllabus pasted in August lists dates from September to April, so "Jan 15"
 * means next January, not one that has already passed. The rule: pick the
 * nearest occurrence that is not in the past.
 */
function inferYear(month: number, day: number, today: DayKey): number {
  const [ty, tm, td] = today.split('-').map(Number);
  const thisYear = `${ty}-${pad(month)}-${pad(day)}`;
  const isPast = month < tm || (month === tm && day < td);
  return isPast ? ty + 1 : Number(thisYear.slice(0, 4));
}

interface DateHit {
  day: DayKey;
  warnings: string[];
}

/** Attempts to read a date out of one fragment. Returns null if it is not one. */
function parseDate(fragment: string, today: DayKey): DateHit | null {
  const s = fragment.trim().replace(/^(due|on|by)\s+/i, '');
  const warnings: string[] = [];

  // ISO, unambiguous, preferred.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { day: `${iso[1]}-${iso[2]}-${iso[3]}`, warnings };

  // "Sept 12", "September 12th, 2026"
  const monthFirst = s.match(/^([A-Za-z.]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
  if (monthFirst) {
    const m = monthFromWord(monthFirst[1]);
    if (m) {
      const d = Number(monthFirst[2]);
      if (d >= 1 && d <= 31) {
        const y = monthFirst[3] ? Number(monthFirst[3]) : inferYear(m, d, today);
        if (!monthFirst[3]) warnings.push(`year assumed ${y}`);
        return { day: `${y}-${pad(m)}-${pad(d)}`, warnings };
      }
    }
  }

  // "12 Sept", "12 September 2026"
  const dayFirst = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z.]+)(?:,?\s*(\d{4}))?$/);
  if (dayFirst) {
    const m = monthFromWord(dayFirst[2]);
    if (m) {
      const d = Number(dayFirst[1]);
      if (d >= 1 && d <= 31) {
        const y = dayFirst[3] ? Number(dayFirst[3]) : inferYear(m, d, today);
        if (!dayFirst[3]) warnings.push(`year assumed ${y}`);
        return { day: `${y}-${pad(m)}-${pad(d)}`, warnings };
      }
    }
  }

  // Slash dates. Read as month/day, which is the North American convention,
  // but flagged when both halves could be either — silently picking one is how
  // a deadline lands five months from where it belongs.
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) {
      if (b <= 12) warnings.push(`read ${a}/${b} as month/day`);
      let y = slash[3] ? Number(slash[3]) : inferYear(a, b, today);
      if (slash[3] && slash[3].length === 2) y += 2000;
      if (!slash[3]) warnings.push(`year assumed ${y}`);
      return { day: `${y}-${pad(a)}-${pad(b)}`, warnings };
    }
  }

  return null;
}

/** Attempts to read a wall-clock time. Returns 'HH:MM' or null. */
function parseTime(fragment: string): string | null {
  const s = fragment.trim().toLowerCase().replace(/^(at|by)\s+/, '');

  const withMeridiem = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (withMeridiem) {
    let h = Number(withMeridiem[1]);
    const m = Number(withMeridiem[2] ?? 0);
    if (h < 1 || h > 12 || m > 59) return null;
    if (withMeridiem[3] === 'pm' && h !== 12) h += 12;
    if (withMeridiem[3] === 'am' && h === 12) h = 0;
    return `${pad(h)}:${pad(m)}`;
  }

  const military = s.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const h = Number(military[1]);
    const m = Number(military[2]);
    if (h > 23 || m > 59) return null;
    return `${pad(h)}:${pad(m)}`;
  }

  return null;
}

/** Attempts to read an effort estimate in minutes. */
function parseEffort(fragment: string): number | null {
  const s = fragment.trim().toLowerCase();

  const hours = s.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)$/);
  if (hours) return Math.round(Number(hours[1]) * 60);

  const mins = s.match(/^(\d+)\s*(m|min|mins|minute|minutes)$/);
  if (mins) return Number(mins[1]);

  return null;
}

/**
 * Event keywords.
 *
 * Only a suggestion. The preview is mandatory, so guessing here costs a
 * glance rather than a wrong row — but the guess is still recorded as a
 * warning so it is visible rather than assumed.
 */
const EVENT_WORDS: [RegExp, EventKind][] = [
  [/\b(final|midterm|exam|test)\b/i, 'exam'],
  [/\blab\b/i, 'lab'],
  [/\b(presentation|seminar|defen[cs]e)\b/i, 'presentation'],
];

/**
 * Words that turn an event noun back into a piece of work.
 *
 * "Lab report" is an assignment about a lab, not a lab; "exam prep" is
 * revision, not the exam. A syllabus is full of both, so matching the bare
 * keyword would file a large share of the semester's actual work as events
 * you merely attend — and events are not something you tick off.
 */
const DELIVERABLE =
  /\b(report|write-?ups?|assignments?|submissions?|notebook|prep|preparation|outlines?|slides?|deck|drafts?|essays?|papers?|summary|reflections?|questions?|worksheets?|problems?\s+set)\b/i;

/**
 * A deliverable noun anywhere in the title wins over the event keyword,
 * because the two are not adjacent as often as you would hope: "midterm
 * review questions" is revision, "final essay" is an essay, "presentation
 * slides" are slides. Only a title with no deliverable in it at all — "Lab 3",
 * "Midterm exam", "Group presentation" — is something you merely attend.
 */
function detectEvent(title: string): { kind: RowKind; eventKind: EventKind; matched: string | null } {
  if (DELIVERABLE.test(title)) return { kind: 'assignment', eventKind: 'other', matched: null };

  for (const [re, eventKind] of EVENT_WORDS) {
    const m = title.match(re);
    if (m) return { kind: 'event', eventKind, matched: m[0] };
  }
  return { kind: 'assignment', eventKind: 'other', matched: null };
}

function matchCourse(fragment: string, courses: CourseRef[]): CourseRef | null {
  const f = fragment.trim().toLowerCase();
  if (!f) return null;

  return (
    courses.find((c) => c.code && c.code.toLowerCase() === f) ??
    courses.find((c) => c.name.toLowerCase() === f) ??
    courses.find((c) => c.code && f.startsWith(c.code.toLowerCase())) ??
    null
  );
}

/**
 * Parses one line.
 *
 * Fragments are classified by what they look like rather than by position, so
 * "Essay, Sep 20, 3h" and "3h, Essay, Sep 20" both work. Whatever is left over
 * and longest becomes the title, which handles the common case of a title that
 * happens to contain a comma.
 */
export function parseLine(line: string, courses: CourseRef[], today: DayKey): ParsedRow {
  const raw = line;
  const warnings: string[] = [];

  // A leading "COURSE:" prefix is treated as authoritative before anything
  // else is considered, since it is the one unambiguous signal.
  let working = line.trim();
  let course: CourseRef | null = null;

  const prefixed = working.match(/^([^:]{1,40}):\s*(.+)$/);
  if (prefixed) {
    const hit = matchCourse(prefixed[1], courses);
    if (hit) {
      course = hit;
      working = prefixed[2];
    } else if (/^[A-Za-z]{2,8}\s?\d{2,4}[A-Za-z]?$/.test(prefixed[1].trim())) {
      // Looks unmistakably like a course code but matches nothing on file.
      // Strip it anyway — leaving "CHEM 233:" glued to the title makes every
      // row on the screen noisier — and say which course is missing, so the
      // fix is obvious rather than mysterious.
      warnings.push(`course "${prefixed[1].trim()}" not found`);
      working = prefixed[2];
    }
  }

  const fragments = working
    .split(/\s+[—–-]\s+|,|\s{2,}|\s+\|\s+/)
    .map((f) => f.trim())
    .filter(Boolean);

  let dueDay: DayKey | null = null;
  let dueTime: string | null = null;
  let effortMinutes: number | null = null;
  const leftovers: string[] = [];

  for (const fragment of fragments) {
    if (!dueDay) {
      const hit = parseDate(fragment, today);
      if (hit) {
        dueDay = hit.day;
        warnings.push(...hit.warnings);
        continue;
      }
    }
    if (!dueTime) {
      const t = parseTime(fragment);
      if (t) {
        dueTime = t;
        continue;
      }
    }
    if (effortMinutes === null) {
      const e = parseEffort(fragment);
      if (e !== null) {
        effortMinutes = e;
        continue;
      }
    }
    if (!course) {
      const hit = matchCourse(fragment, courses);
      if (hit) {
        course = hit;
        continue;
      }
    }
    leftovers.push(fragment);
  }

  // A date and a time can also arrive stuck together inside the leftover text,
  // e.g. "Essay draft due Sep 20 at 5pm". Sweep the remainder for both.
  if (leftovers.length && (!dueDay || !dueTime)) {
    for (let i = 0; i < leftovers.length; i++) {
      const words = leftovers[i].split(/\s+/);
      for (let start = 0; start < words.length; start++) {
        for (let len = 3; len >= 1; len--) {
          const chunk = words.slice(start, start + len).join(' ');
          if (!dueDay) {
            const hit = parseDate(chunk, today);
            if (hit) {
              dueDay = hit.day;
              warnings.push(...hit.warnings);
              words.splice(start, len);
              start -= 1;
              break;
            }
          }
          if (!dueTime && len === 1) {
            const t = parseTime(chunk);
            if (t) {
              dueTime = t;
              words.splice(start, len);
              start -= 1;
              break;
            }
          }
        }
      }
      leftovers[i] = words.join(' ').replace(/\s+(due|at|by|on)$/i, '').trim();
    }
  }

  const title = leftovers
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0]
    ?.replace(/\s+/g, ' ')
    .trim();

  if (!title) {
    return {
      raw,
      title: '',
      kind: 'assignment',
      eventKind: 'other',
      courseId: null,
      dueDay: null,
      dueTime: null,
      effortMinutes: null,
      warnings: ['no title found'],
      usable: false,
    };
  }

  const detected = detectEvent(title);
  if (detected.matched) {
    warnings.push(`read as ${detected.eventKind} because of "${detected.matched}"`);
  }
  if (!dueDay) warnings.push('no date found');
  if (!course && courses.length) warnings.push('no course matched');

  return {
    raw,
    title,
    kind: detected.kind,
    eventKind: detected.eventKind,
    courseId: course?.id ?? null,
    dueDay,
    dueTime,
    effortMinutes,
    warnings,
    usable: true,
  };
}

/** Parses a whole paste. Blank lines and obvious headings are dropped. */
export function parseBulk(
  text: string,
  courses: CourseRef[] = [],
  today: DayKey = todayKey(),
): ParsedRow[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^[\s•*\-•]+/, '').trim())
    .filter((l) => l.length > 1)
    .map((l) => parseLine(l, courses, today));
}

/**
 * Turns a confirmed row into the timestamp to store.
 *
 * The default time depends on what the row IS, which is easy to get wrong by
 * sharing one rule:
 *
 *   An assignment with no time is due at the END of its day. "Due Friday"
 *   means by the end of Friday, and storing midnight makes it look overdue
 *   for the entire day it is actually due.
 *
 *   An event with no time STARTS at the beginning of its day. An all-day exam
 *   stored at 23:59 sorts below everything else on the day it happens, and
 *   would make a T-1 reminder fire on the wrong evening.
 */
export function dueTimestamp(row: ParsedRow, timezone?: string): string | null {
  if (!row.dueDay) return null;

  const fallback: [number, number] = row.kind === 'event' ? [0, 0] : [23, 59];
  const [h, m] = row.dueTime ? row.dueTime.split(':').map(Number) : fallback;

  return wallClockToUTC(row.dueDay, h, m, 0, timezone).toISOString();
}

/** A short human summary of a parse, for the preview header. */
export function summarise(rows: ParsedRow[]): string {
  const usable = rows.filter((r) => r.usable);
  const events = usable.filter((r) => r.kind === 'event').length;
  const assignments = usable.length - events;
  const undated = usable.filter((r) => !r.dueDay).length;

  const parts: string[] = [];
  if (assignments) parts.push(`${assignments} assignment${assignments === 1 ? '' : 's'}`);
  if (events) parts.push(`${events} event${events === 1 ? '' : 's'}`);
  if (!parts.length) return 'Nothing to add.';

  let s = parts.join(' and ');
  if (undated) s += `, ${undated} without a date`;
  return `${s}.`;
}

/** Days between today and a parsed date, for sanity-checking a paste. */
export function looksFarOff(row: ParsedRow, today: DayKey = todayKey()): boolean {
  if (!row.dueDay) return false;
  return row.dueDay > addDays(today, 400) || row.dueDay < localDayKey(new Date(0));
}

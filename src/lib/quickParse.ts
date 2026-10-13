import { addDays, isoWeekday, type DayKey } from './time';

/**
 * Plain-language capture, read on the device.
 *
 * "lab report thu 5pm phys" becomes a piece of work titled "Lab report", due
 * Thursday at 5:00 p.m., in PHYS 205. No model, no network: it works offline
 * and costs nothing, and it is shown under the capture box before Enter, with
 * each part removable, so nothing is written that was not seen (rule 6).
 *
 * It only ever reads what is plainly there. A thought with no date stays a
 * thought and goes to the inbox as before; a course on its own is not enough
 * to turn a thought into work. Ambiguity is resolved one way and shown: a
 * weekday is its next occurrence after today, and the preview says which day
 * that is, so "fri" on a Friday visibly means next week rather than silently
 * meaning either.
 */

export interface CourseRef {
  id: string;
  code: string | null;
  name: string;
}

export interface QuickRead {
  title: string;
  day: DayKey;
  /** Local wall-clock 'HH:MM', or null for the end of the day. */
  time: string | null;
  course: CourseRef | null;
  /** Exams and presentations become events, which get the night-before escalation. */
  kind: 'work' | 'exam' | 'presentation';
}

const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

type Span = [number, number];

const pad = (n: number) => String(n).padStart(2, '0');

function validDay(y: number, m: number, d: number): DayKey | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}` as DayKey;
}

/** A month and day with no year: this year, unless that is already behind us. */
function nearestYear(today: DayKey, m: number, d: number): DayKey | null {
  const y = Number(today.slice(0, 4));
  const thisYear = validDay(y, m, d);
  if (!thisYear) return null;
  return thisYear < addDays(today, -1) ? validDay(y + 1, m, d) : thisYear;
}

function findDay(text: string, today: DayKey): { day: DayKey; span: Span } | null {
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;

  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower))) {
    const day = validDay(Number(m[1]), Number(m[2]), Number(m[3]));
    if (day) return { day, span: [m.index, m.index + m[0].length] };
  }

  const monthNames = Object.keys(MONTHS).join('|');
  const monthFirst = new RegExp(`\\b(${monthNames})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`);
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})[a-z]*\\b`);
  if ((m = monthFirst.exec(lower))) {
    const day = nearestYear(today, MONTHS[m[1]], Number(m[2]));
    if (day) return { day, span: [m.index, m.index + m[0].length] };
  }
  if ((m = dayFirst.exec(lower))) {
    const day = nearestYear(today, MONTHS[m[2]], Number(m[1]));
    if (day) return { day, span: [m.index, m.index + m[0].length] };
  }

  if ((m = /\bin\s+(\d{1,2}|a|an|one|two|three|four|five|six|seven)\s+(days?|weeks?)\b/.exec(lower))) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    const days = m[2].startsWith('week') ? n * 7 : n;
    if (days > 0 && days <= 365) return { day: addDays(today, days), span: [m.index, m.index + m[0].length] };
  }

  if ((m = /\b(today|tonight|tomorrow|tmrw|tmr)\b/.exec(lower))) {
    const offset = m[1] === 'today' || m[1] === 'tonight' ? 0 : 1;
    return { day: addDays(today, offset), span: [m.index, m.index + m[0].length] };
  }

  const weekdayNames = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
  const weekday = new RegExp(`\\b(on\\s+|by\\s+|due\\s+|next\\s+|this\\s+)?(${weekdayNames})\\b`, 'g');
  while ((m = weekday.exec(lower))) {
    // "sat" and "sun" are everyday words ("sat the quiz"); short, they count
    // only after a word that makes them a day.
    if ((m[2] === 'sat' || m[2] === 'sun') && !m[1]) continue;
    const want = WEEKDAYS[m[2]];
    const now = isoWeekday(today);
    const ahead = ((want - now + 7) % 7) || 7;
    // The leading word goes with the day: "lab due fri" leaves "Lab".
    return { day: addDays(today, ahead), span: [m.index, m.index + m[0].length] };
  }
  return null;
}

function findTime(text: string): { time: string; span: Span } | null {
  const lower = text.toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$|[,.;!?])/.exec(lower))) {
    let h = Number(m[1]);
    if (h < 1 || h > 12) return null;
    const pm = m[3].startsWith('p');
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return { time: `${pad(h)}:${m[2] ?? '00'}`, span: [m.index, m.index + m[0].length] };
  }
  if ((m = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(lower))) {
    return { time: `${pad(Number(m[1]))}:${m[2]}`, span: [m.index, m.index + m[0].length] };
  }
  if ((m = /\b(noon|midday|midnight)\b/.exec(lower))) {
    // A deadline "at midnight" means the end of that day, not its first minute.
    return { time: m[1] === 'midnight' ? '23:59' : '12:00', span: [m.index, m.index + m[0].length] };
  }
  return null;
}

function findCourse(text: string, courses: CourseRef[]): { course: CourseRef; span: Span } | null {
  const lower = text.toLowerCase();
  const hits: { course: CourseRef; span: Span }[] = [];
  for (const c of courses) {
    const code = c.code?.trim().toLowerCase();
    if (!code) continue;
    const parts = /^([a-z]{2,5})\s*-?\s*(\d{3,4}[a-z]?)$/.exec(code);
    if (!parts) continue;
    const m = new RegExp(`\\b${parts[1]}\\s*-?\\s*${parts[2]}\\b`).exec(lower);
    if (m) hits.push({ course: c, span: [m.index, m.index + m[0].length] });
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return null;

  // The subject alone ("phys"), when only one course has it.
  const bySubject = new Map<string, CourseRef[]>();
  for (const c of courses) {
    const subject = /^([a-z]{2,5})/.exec(c.code?.trim().toLowerCase() ?? '')?.[1];
    if (subject) bySubject.set(subject, [...(bySubject.get(subject) ?? []), c]);
  }
  for (const [subject, list] of bySubject) {
    if (list.length !== 1) continue;
    const m = new RegExp(`\\b${subject}\\b`).exec(lower);
    if (m) return { course: list[0], span: [m.index, m.index + m[0].length] };
  }
  return null;
}

const CONNECTORS = /^(due|by|on|at|for|in|before|until)$/i;

/** The words left once the date, time and course are taken out, tidied into a title. */
function titleWithout(text: string, spans: Span[]): string {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [s, e] of sorted) {
    out += `${text.slice(at, s)} `;
    at = Math.max(at, e);
  }
  out += text.slice(at);
  const words = out.split(/\s+/).filter(Boolean);
  // Drop connectors left dangling ("due", "at") and stray punctuation.
  const kept = words.filter((w, i) => {
    if (!CONNECTORS.test(w)) return true;
    const next = words[i + 1];
    return Boolean(next) && !CONNECTORS.test(next) && i > 0;
  });
  const title = kept.join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '');
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : '';
}

export interface ReadOptions {
  today: DayKey;
  /** Local 'HH:MM' now, so a bare time already past means tomorrow. */
  nowTime: string;
  courses: CourseRef[];
  /** Parts the person has removed from the preview. */
  without?: { date?: boolean; course?: boolean };
}

/** What the capture box would add, or null when it is a thought for the inbox. */
export function readCapture(text: string, o: ReadOptions): QuickRead | null {
  const raw = text.trim();
  if (raw.length < 3 || o.without?.date) return null;

  const dayHit = findDay(raw, o.today);
  const timeHit = findTime(raw);
  if (!dayHit && !timeHit) return null;

  let day = dayHit?.day ?? o.today;
  // A time on its own: today, or tomorrow once that time has passed.
  if (!dayHit && timeHit && timeHit.time <= o.nowTime) day = addDays(o.today, 1);

  const courseHit = o.without?.course ? null : findCourse(raw, o.courses);
  const spans = [dayHit?.span, timeHit?.span, courseHit?.span].filter((s): s is Span => Boolean(s));
  const title = titleWithout(raw, spans) || raw;

  const lower = title.toLowerCase();
  const kind = /\b(midterm|exam|final exam|finals)\b/.test(lower) ? 'exam' : /\bpresentation\b/.test(lower) ? 'presentation' : 'work';

  return { title, day, time: timeHit?.time ?? null, course: courseHit?.course ?? null, kind };
}

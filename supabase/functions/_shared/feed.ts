import {
  addDays,
  daysBetween,
  isoWeekday,
  startOfDayUTC,
  wallClockToUTC,
  type DayKey,
} from './time.ts';
import { unfold } from './icsparse.ts';

/**
 * Reading a live calendar feed into concrete events.
 *
 * WHY THIS IS NOT icsparse.ts
 *
 * icsparse was written for a one-time paste of a university timetable, and
 * three of its shortcuts are right for that job and wrong for this one:
 *
 *   - It converts UTC stamps with a single fixed offset. A term that crosses
 *     the November clock change puts every later lecture an hour out. For a
 *     paste that is previewed and confirmed, tolerable; for a mirror that
 *     refreshes itself every five minutes with nobody checking, it is a
 *     confidently wrong time on every event after the change.
 *
 *   - It expands a repeat forward from the FIRST occurrence and stops after
 *     sixty. A weekly meeting that started in 2024 therefore produces 2024
 *     dates and nothing now. The longest-running recurring events — the ones
 *     a person relies on most — would be the ones that silently vanish.
 *
 *   - It has no notion of an instance being cancelled (EXDATE) or moved
 *     (RECURRENCE-ID). A live calendar is full of both: the cancelled meeting
 *     would still show, and the moved one would show twice.
 *
 * So this reader expands every repeat in WALL-CLOCK time in the event's own
 * zone and converts each occurrence separately, which is what makes a 09:00
 * meeting stay at 09:00 across a DST change; applies cancellations and moves;
 * and only returns what falls inside a bounded window around today.
 *
 * WHAT IT REFUSES TO GUESS
 *
 * RRULE is a deep specification and this covers the parts real calendars
 * actually emit — daily, weekly, monthly and yearly repeats with an interval,
 * a count or an end date, weekdays, "second Tuesday", "last Friday", a day of
 * the month. A rule that uses anything else (BYSETPOS, BYWEEKNO, hourly
 * repeats) is left OUT and named in `problems`, rather than expanded
 * partially. A half-understood repeat produces a set of dates that looks
 * complete and is not, which is the worst available output for a calendar.
 */

export interface FeedInstance {
  /** The VEVENT's UID. With `startsAt`, the identity of this occurrence. */
  uid: string;
  title: string;
  location: string | null;
  /** ISO instant, UTC. */
  startsAt: string;
  /** ISO instant, UTC, or null for a point-in-time or single-day event. */
  endsAt: string | null;
  allDay: boolean;
}

export interface FeedParse {
  /** X-WR-CALNAME, when the feed names itself. */
  name: string | null;
  instances: FeedInstance[];
  /**
   * What could not be read, in plain words. Shown on the feed's status line —
   * a subscription that quietly drops events is the failure this feature
   * exists to prevent.
   */
  problems: string[];
}

export interface FeedWindow {
  /** The account's IANA zone. Used for all-day events and floating times. */
  zone: string;
  /** First local day to include. */
  from: DayKey;
  /** Last local day to include. */
  to: DayKey;
}

/* ============================================================================
   Lines and properties
   ========================================================================= */

interface Prop {
  name: string;
  /** Parameter names uppercased; values kept as written, quotes removed. */
  params: Record<string, string>;
  value: string;
}

/**
 * One content line into name, parameters and value.
 *
 * Quote-aware, because a quoted parameter may legally contain the colon that
 * otherwise separates the value: `DTSTART;TZID="GMT+01:00":20260910T090000`.
 * Parameter VALUES keep their case — `America/Toronto` must stay
 * `America/Toronto` to be looked up as a zone.
 */
function splitProp(line: string): Prop | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const left = line.slice(0, colon);
  const segments: string[] = [];
  let buf = '';
  inQuotes = false;
  for (const c of left) {
    if (c === '"') inQuotes = !inQuotes;
    if (c === ';' && !inQuotes) {
      segments.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  segments.push(buf);

  const params: Record<string, string> = {};
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf('=');
    if (eq === -1) continue;
    params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1).replace(/^"|"$/g, '');
  }

  return { name: segments[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

/** ICS escaping, reversed. Backslash last, or `\\n` becomes a newline. */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/* ============================================================================
   Zones
   ========================================================================= */

function isZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

/**
 * Outlook and Exchange publish Windows zone names rather than IANA ones.
 * Intl does not know them, and treating "Eastern Standard Time" as unreadable
 * would put every Outlook event in the wrong zone. The common ones only; an
 * unknown name falls back to the account's zone and is reported.
 */
const WINDOWS_ZONES: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Coordinated Universal Time': 'UTC',
  UTC: 'UTC',
};

/**
 * A TZID parameter into an IANA zone, or null.
 *
 * Also strips the path prefixes some producers put in front of the name
 * (`/mozilla.org/20050126_1/America/Toronto`), which Intl rejects even though
 * the zone at the end of them is perfectly ordinary.
 */
function resolveZone(tzid: string): string | null {
  const name = tzid.trim();
  if (isZone(name)) return name;
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name];

  const parts = name.split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const tail = parts.slice(i).join('/');
    if (isZone(tail)) return tail;
  }
  return null;
}

/* ============================================================================
   Stamps
   ========================================================================= */

type Stamp =
  | { kind: 'date'; day: DayKey }
  | { kind: 'time'; day: DayKey; h: number; m: number; s: number; zone: string };

/**
 * A date or date-time value with its parameters.
 *
 * Z means UTC. A TZID names the zone the wall-clock time is in. Neither means
 * a floating time, which the feed's own X-WR-TIMEZONE governs if it has one
 * and the account's zone otherwise.
 */
function parseStamp(
  raw: string,
  params: Record<string, string>,
  floatingZone: string,
  onUnknownZone: (tzid: string) => void,
): Stamp | null {
  const value = raw.trim();

  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date || params.VALUE === 'DATE') {
    const m = date ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    return { kind: 'date', day: `${m[1]}-${m[2]}-${m[3]}` };
  }

  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!dt) return null;

  let zone = floatingZone;
  if (dt[7]) zone = 'UTC';
  else if (params.TZID) {
    const resolved = resolveZone(params.TZID);
    if (resolved) zone = resolved;
    else onUnknownZone(params.TZID);
  }

  return {
    kind: 'time',
    day: `${dt[1]}-${dt[2]}-${dt[3]}`,
    h: Number(dt[4]),
    m: Number(dt[5]),
    s: Number(dt[6]),
    zone,
  };
}

/** The UTC instant a timed stamp names. */
function instantOf(s: Extract<Stamp, { kind: 'time' }>): number {
  return wallClockToUTC(s.day, s.h, s.m, s.s, s.zone).getTime();
}

/** The local calendar day an instant falls on, in a zone. */
function dayIn(instantMs: number, zone: string): DayKey {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `P1W`, `PT1H30M`, `P2D` → milliseconds. Nominal days count as 24 hours. */
function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const n = (i: number) => Number(m[i] ?? 0);
  const ms =
    ((n(2) * 7 + n(3)) * 86_400 + n(4) * 3_600 + n(5) * 60 + n(6)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/* ============================================================================
   Recurrence
   ========================================================================= */

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: Stamp | null;
  /** `n` is the ordinal ("2" in 2TU, "-1" in -1FR), null when absent. */
  byday: { n: number | null; wd: number }[];
  bymonthday: number[];
  bymonth: number[];
  /** Week start, ISO weekday. Monday unless the rule says otherwise. */
  wkst: number;
}

const WEEKDAY: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

/** Parts of RRULE this reader deliberately does not implement. */
const UNSUPPORTED_PARTS = ['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND'];

function parseRule(
  value: string,
  floatingZone: string,
  onUnknownZone: (tzid: string) => void,
): Rule | { unsupported: string } {
  const parts = new Map<string, string>();
  for (const p of value.split(';')) {
    const eq = p.indexOf('=');
    if (eq > 0) parts.set(p.slice(0, eq).toUpperCase(), p.slice(eq + 1));
  }

  const freq = (parts.get('FREQ') ?? '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    return { unsupported: `repeats ${freq ? freq.toLowerCase() : 'on an unreadable rule'}` };
  }

  for (const part of UNSUPPORTED_PARTS) {
    if (parts.has(part)) return { unsupported: `uses ${part}` };
  }

  const byday: Rule['byday'] = [];
  for (const token of (parts.get('BYDAY') ?? '').split(',').filter(Boolean)) {
    const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(token.trim());
    if (!m) return { unsupported: `has a weekday rule it cannot read (${token})` };
    byday.push({ n: m[1] ? Number(m[1]) : null, wd: WEEKDAY[m[2].toUpperCase()] });
  }

  // An ordinal only means something within a month or a year.
  if (byday.some((d) => d.n !== null) && (freq === 'DAILY' || freq === 'WEEKLY')) {
    return { unsupported: 'puts an ordinal on a daily or weekly repeat' };
  }

  const bymonth = (parts.get('BYMONTH') ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);
  const bymonthday = (parts.get('BYMONTHDAY') ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);

  // "The 20th Monday of the year" needs BYYEARDAY-style counting across months.
  if (freq === 'YEARLY' && byday.length > 0 && bymonth.length === 0) {
    return { unsupported: 'counts weekdays across a whole year' };
  }

  const untilRaw = parts.get('UNTIL');
  const until = untilRaw ? parseStamp(untilRaw, {}, floatingZone, onUnknownZone) : null;

  return {
    freq: freq as Rule['freq'],
    interval: Math.max(1, Number(parts.get('INTERVAL') ?? '1') || 1),
    count: parts.has('COUNT') ? Math.max(0, Number(parts.get('COUNT')) || 0) : null,
    until,
    byday,
    bymonthday,
    bymonth,
    wkst: WEEKDAY[(parts.get('WKST') ?? 'MO').toUpperCase()] ?? 1,
  };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function key(y: number, m: number, d: number): DayKey {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

/** The nth `wd` of a month; n < 0 counts from the end. Null if it does not exist. */
function nthWeekday(y: number, m: number, wd: number, n: number): DayKey | null {
  const last = daysInMonth(y, m);
  if (n > 0) {
    const firstWd = isoWeekday(key(y, m, 1));
    const day = 1 + ((wd - firstWd + 7) % 7) + (n - 1) * 7;
    return day <= last ? key(y, m, day) : null;
  }
  const lastWd = isoWeekday(key(y, m, last));
  const day = last - ((lastWd - wd + 7) % 7) + (n + 1) * 7;
  return day >= 1 ? key(y, m, day) : null;
}

/** Every day in a month the rule's day-of-month and weekday parts select. */
function monthDays(y: number, m: number, rule: Rule, startDay: DayKey): DayKey[] {
  const last = daysInMonth(y, m);
  const out = new Set<DayKey>();

  if (rule.bymonthday.length > 0) {
    for (const n of rule.bymonthday) {
      const d = n > 0 ? n : last + n + 1;
      if (d >= 1 && d <= last) out.add(key(y, m, d));
    }
    // In a monthly rule, BYDAY LIMITS BYMONTHDAY rather than adding to it.
    if (rule.byday.length > 0) {
      const wanted = new Set(rule.byday.map((b) => b.wd));
      for (const d of [...out]) if (!wanted.has(isoWeekday(d))) out.delete(d);
    }
  } else if (rule.byday.length > 0) {
    for (const { n, wd } of rule.byday) {
      if (n !== null) {
        const d = nthWeekday(y, m, wd, n);
        if (d) out.add(d);
      } else {
        for (let d = 1; d <= last; d++) {
          if (isoWeekday(key(y, m, d)) === wd) out.add(key(y, m, d));
        }
      }
    }
  } else {
    // The start's own day of the month. A month without it is skipped, per
    // the spec — "monthly on the 31st" does not become "the 30th in April".
    const d0 = Number(startDay.slice(8, 10));
    if (d0 <= last) out.add(key(y, m, d0));
  }

  return [...out].sort();
}

/** Upper bound on generated occurrences per event, from its first one. */
const MAX_GENERATED = 50_000;
/** Upper bound on periods walked, so a rule that never matches cannot spin. */
const MAX_PERIODS = 20_000;

/**
 * Candidate days, in order, from the start day onwards.
 *
 * A generator so the caller decides when to stop — COUNT, UNTIL, or the end
 * of the window, whichever comes first.
 */
function* candidateDays(start: DayKey, rule: Rule): Generator<DayKey> {
  const monthFilter = (d: DayKey) =>
    rule.bymonth.length === 0 || rule.bymonth.includes(Number(d.slice(5, 7)));

  if (rule.freq === 'DAILY') {
    const wanted = new Set(rule.byday.map((b) => b.wd));
    for (let i = 0; i < MAX_PERIODS * 7; i++) {
      const d = addDays(start, i * rule.interval);
      if (wanted.size > 0 && !wanted.has(isoWeekday(d))) continue;
      if (rule.bymonthday.length > 0 && !rule.bymonthday.includes(Number(d.slice(8, 10)))) continue;
      if (!monthFilter(d)) continue;
      yield d;
    }
    return;
  }

  if (rule.freq === 'WEEKLY') {
    const offset = (wd: number) => (wd - rule.wkst + 7) % 7;
    const weekdays = (rule.byday.length > 0 ? rule.byday.map((b) => b.wd) : [isoWeekday(start)])
      .filter((wd, i, all) => all.indexOf(wd) === i)
      .sort((a, b) => offset(a) - offset(b));

    // Weeks are counted from the week CONTAINING the start, aligned to WKST.
    // Counting from the start day itself misaligns every-other-week rules
    // whenever the series does not begin on the first day of the week.
    const weekStart = addDays(start, -offset(isoWeekday(start)));

    for (let w = 0; w < MAX_PERIODS; w++) {
      const ws = addDays(weekStart, w * 7 * rule.interval);
      for (const wd of weekdays) {
        const d = addDays(ws, offset(wd));
        if (d < start || !monthFilter(d)) continue;
        yield d;
      }
    }
    return;
  }

  const y0 = Number(start.slice(0, 4));
  const m0 = Number(start.slice(5, 7));

  if (rule.freq === 'MONTHLY') {
    for (let k = 0; k < MAX_PERIODS; k++) {
      const idx = m0 - 1 + k * rule.interval;
      const y = y0 + Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      if (rule.bymonth.length > 0 && !rule.bymonth.includes(m)) continue;
      for (const d of monthDays(y, m, rule, start)) {
        if (d >= start) yield d;
      }
    }
    return;
  }

  // YEARLY
  for (let k = 0; k < MAX_PERIODS; k++) {
    const y = y0 + k * rule.interval;
    const months = rule.bymonth.length > 0 ? [...rule.bymonth].sort((a, b) => a - b) : [m0];
    for (const m of months) {
      const days =
        rule.bymonthday.length > 0 || rule.byday.length > 0
          ? monthDays(y, m, rule, start)
          : (() => {
              // The start's own month and day. February 29th is skipped in
              // years that do not have one, rather than moved to the 28th.
              const d0 = Number(start.slice(8, 10));
              return d0 <= daysInMonth(y, m) ? [key(y, m, d0)] : [];
            })();
      for (const d of days) if (d >= start) yield d;
    }
  }
}

/* ============================================================================
   The reader
   ========================================================================= */

interface RawEvent {
  props: Prop[];
}

function first(ev: RawEvent, name: string): Prop | undefined {
  return ev.props.find((p) => p.name === name);
}

function all(ev: RawEvent, name: string): Prop[] {
  return ev.props.filter((p) => p.name === name);
}

/**
 * The identity of one occurrence, for matching EXDATE and RECURRENCE-ID
 * against what a rule generated. Timed occurrences compare by instant, so a
 * cancellation written in UTC still matches an occurrence generated in
 * Toronto time; all-day ones compare by day.
 */
function occurrenceKey(s: Stamp): string {
  return s.kind === 'date' ? `d:${s.day}` : `t:${instantOf(s)}`;
}

const MAX_TITLE = 300;
const MAX_LOCATION = 300;

export function parseFeed(text: string, win: FeedWindow): FeedParse {
  const lines = unfold(text);
  const problems = new Set<string>();

  let name: string | null = null;
  let feedZone: string | null = null;
  const events: RawEvent[] = [];

  // A stack rather than a flag: VALARM sits INSIDE a VEVENT and has lines of
  // its own, and VTIMEZONE blocks carry DTSTART lines that belong to no event.
  const stack: string[] = [];
  let current: RawEvent | null = null;

  for (const line of lines) {
    const prop = splitProp(line);
    if (!prop) continue;

    if (prop.name === 'BEGIN') {
      const what = prop.value.trim().toUpperCase();
      stack.push(what);
      if (what === 'VEVENT' && stack.length === 2) current = { props: [] };
      continue;
    }
    if (prop.name === 'END') {
      const what = stack.pop();
      if (what === 'VEVENT' && current) {
        events.push(current);
        current = null;
      }
      continue;
    }

    const top = stack[stack.length - 1];
    if (top === 'VCALENDAR') {
      if (prop.name === 'X-WR-CALNAME') name = unescapeText(prop.value).trim() || null;
      if (prop.name === 'X-WR-TIMEZONE') feedZone = resolveZone(prop.value);
    } else if (top === 'VEVENT' && current) {
      current.props.push(prop);
    }
  }

  const floating = feedZone ?? win.zone;
  const windowStart = startOfDayUTC(win.from, win.zone).getTime();
  const windowEnd = startOfDayUTC(addDays(win.to, 1), win.zone).getTime();

  const unknownZones = new Set<string>();
  const noteZone = (tzid: string) => unknownZones.add(tzid);

  /*
   * Overrides first. A VEVENT with a RECURRENCE-ID replaces one occurrence of
   * the series sharing its UID — it is either that occurrence moved or
   * retitled, or, with STATUS:CANCELLED, that occurrence removed.
   */
  const overridden = new Map<string, Set<string>>();
  for (const ev of events) {
    const rid = first(ev, 'RECURRENCE-ID');
    const uid = first(ev, 'UID')?.value.trim();
    if (!rid || !uid) continue;
    const stamp = parseStamp(rid.value, rid.params, floating, noteZone);
    if (!stamp) continue;
    const set = overridden.get(uid) ?? new Set<string>();
    set.add(occurrenceKey(stamp));
    overridden.set(uid, set);
  }

  const out = new Map<string, FeedInstance>();

  const emit = (inst: FeedInstance) => {
    const start = Date.parse(inst.startsAt);
    const end = inst.endsAt ? Date.parse(inst.endsAt) : start;
    // Overlap, not containment: a three-day conference that began yesterday
    // is on today's calendar.
    if (start >= windowEnd || end < windowStart) return;
    out.set(`${inst.uid}|${start}`, inst);
  };

  for (const ev of events) {
    const title = unescapeText(first(ev, 'SUMMARY')?.value ?? '').trim().slice(0, MAX_TITLE) ||
      'Untitled event';

    const status = first(ev, 'STATUS')?.value.trim().toUpperCase();
    const isOverride = Boolean(first(ev, 'RECURRENCE-ID'));
    // A cancelled override removes its occurrence, which happened above. A
    // cancelled master removes the whole event. Either way nothing is shown.
    if (status === 'CANCELLED') continue;

    const dtstart = first(ev, 'DTSTART');
    const start = dtstart ? parseStamp(dtstart.value, dtstart.params, floating, noteZone) : null;
    if (!start) {
      problems.add(`"${title}" has no readable start time.`);
      continue;
    }

    // A missing UID would make every sync a delete-and-reinsert of this event.
    // The start plus the title is stable across refreshes, which is all the
    // identity needs to be.
    const uid =
      first(ev, 'UID')?.value.trim() ||
      `nouid:${occurrenceKey(start)}:${title}`;

    const location = unescapeText(first(ev, 'LOCATION')?.value ?? '').trim().slice(0, MAX_LOCATION) ||
      null;

    // ---- how long ------------------------------------------------------
    const dtend = first(ev, 'DTEND');
    const endStamp = dtend ? parseStamp(dtend.value, dtend.params, floating, noteZone) : null;
    const duration = first(ev, 'DURATION');

    let spanDays = 1; // all-day: how many days
    let spanMs = 0; // timed: how long
    if (start.kind === 'date') {
      if (endStamp?.kind === 'date') spanDays = Math.max(1, daysBetween(start.day, endStamp.day));
      else if (duration) spanDays = Math.max(1, Math.round((parseDuration(duration.value) ?? 86_400_000) / 86_400_000));
    } else {
      if (endStamp?.kind === 'time') spanMs = Math.max(0, instantOf(endStamp) - instantOf(start));
      else if (duration) spanMs = Math.max(0, parseDuration(duration.value) ?? 0);
    }

    const build = (occ: Stamp): FeedInstance => {
      if (occ.kind === 'date') {
        return {
          uid,
          title,
          location,
          allDay: true,
          // All-day dates are floating calendar days: the day is the day, in
          // the reader's zone. Same storage rule as a hand-added all-day event.
          startsAt: startOfDayUTC(occ.day, win.zone).toISOString(),
          endsAt:
            spanDays > 1
              ? startOfDayUTC(addDays(occ.day, spanDays), win.zone).toISOString()
              : null,
        };
      }
      const at = instantOf(occ);
      return {
        uid,
        title,
        location,
        allDay: false,
        startsAt: new Date(at).toISOString(),
        endsAt: spanMs > 0 ? new Date(at + spanMs).toISOString() : null,
      };
    };

    const rrule = first(ev, 'RRULE');

    // ---- a single occurrence -----------------------------------------------
    if (!rrule || isOverride) {
      emit(build(start));
      continue;
    }

    // ---- a series ------------------------------------------------------
    const rule = parseRule(rrule.value, floating, noteZone);
    if ('unsupported' in rule) {
      problems.add(`"${title}" repeats in a way the app can't read yet (${rule.unsupported}), so it is left out.`);
      continue;
    }

    const excluded = new Set<string>();
    const excludedDays = new Set<DayKey>();
    for (const ex of all(ev, 'EXDATE')) {
      for (const v of ex.value.split(',')) {
        const s = parseStamp(v, ex.params, floating, noteZone);
        if (!s) continue;
        excluded.add(occurrenceKey(s));
        // A date-only EXDATE on a timed series cancels that whole day.
        if (s.kind === 'date') excludedDays.add(s.day);
      }
    }
    const moved = overridden.get(uid) ?? new Set<string>();

    const untilMs = rule.until?.kind === 'time' ? instantOf(rule.until) : null;
    const untilDay = rule.until?.kind === 'date' ? rule.until.day : null;

    /*
     * Day-key bounds, so the expensive part only runs where it matters.
     *
     * Converting an occurrence to an instant goes through Intl twice, and a
     * daily series that began in 2015 has four thousand occurrences before
     * the window opens. Every one of them has to be COUNTED — COUNT is
     * measured from the first occurrence, not from the window — but none of
     * them needs converting. Comparing day keys is string comparison and
     * free, and a two-day margin either side absorbs any zone offset, so the
     * precise instant checks below still decide every case near a boundary.
     *
     * This matters more than it looks: Google publishes no ETag or
     * Last-Modified, so a Google feed is read in full on every sync, and an
     * edge function has a CPU ceiling.
     */
    const firstNeeded = addDays(win.from, -2);
    const lastNeeded = addDays(win.to, 2);
    const untilZoneDay =
      untilMs !== null && start.kind === 'time' ? dayIn(untilMs, start.zone) : null;

    let generated = 0;
    for (const day of candidateDays(start.day, rule)) {
      generated++;
      if (rule.count !== null && generated > rule.count) break;
      if (generated > MAX_GENERATED) {
        problems.add(`"${title}" repeats too many times to read in full, so later dates may be missing.`);
        break;
      }

      if (untilDay !== null && day > untilDay) break;
      if (untilZoneDay !== null && day > addDays(untilZoneDay, 1)) break;
      if (day > lastNeeded) break;
      // Counted above; nowhere near the window, so nothing more to do.
      if (day < firstNeeded) continue;

      const occ: Stamp =
        start.kind === 'date'
          ? { kind: 'date', day }
          : { ...start, day };

      const occStart = occ.kind === 'date' ? startOfDayUTC(day, win.zone).getTime() : instantOf(occ);

      if (untilMs !== null && occStart > untilMs) break;
      if (occStart >= windowEnd) break;

      const k = occurrenceKey(occ);
      if (excluded.has(k) || moved.has(k)) continue;
      if (occ.kind === 'time' && excludedDays.has(dayIn(occStart, occ.zone))) continue;

      emit(build(occ));
    }

    // RDATE: extra one-off occurrences of the series. Not subject to COUNT.
    for (const rd of all(ev, 'RDATE')) {
      if ((rd.params.VALUE ?? '').toUpperCase() === 'PERIOD') continue;
      for (const v of rd.value.split(',')) {
        const s = parseStamp(v, rd.params, floating, noteZone);
        if (!s) continue;
        const k = occurrenceKey(s);
        if (excluded.has(k) || moved.has(k)) continue;
        emit(build(s));
      }
    }
  }

  for (const tzid of unknownZones) {
    problems.add(`Some events use a timezone the app doesn't recognise ("${tzid}"), so they are shown in yours.`);
  }

  const instances = [...out.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { name, instances, problems: [...problems].slice(0, 20) };
}

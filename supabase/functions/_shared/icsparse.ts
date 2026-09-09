import { addDays, isoWeekday, type DayKey } from './time.ts';

/**
 * Reading an .ics feed, so a university timetable can come IN.
 *
 * The app has published an .ics since Phase 7 and could never read one. That
 * asymmetry is most of why there is no class schedule in here: every
 * university publishes a timetable feed, and the alternative to importing it
 * is typing thirteen weeks of lectures by hand, which nobody does.
 *
 * WHAT THIS DELIBERATELY DOES NOT TRY TO BE
 *
 * A complete RFC 5545 implementation. That standard has floating times,
 * VTIMEZONE definitions, RDATE, EXDATE, recurrence overrides and an entire
 * alarm subsystem, and a half-built version of all of it would fail in ways
 * that look like data rather than like a parser limitation.
 *
 * So the scope is exactly one job: the weekly repeating events a course
 * timetable is made of. Anything it cannot read with confidence is REPORTED
 * as unread rather than guessed at — the same rule the syllabus importer
 * follows, and for the same reason. Losing a lecture silently is worse than
 * saying "four events could not be read".
 */

export interface ParsedEvent {
  uid: string | null;
  summary: string;
  location: string | null;
  /** Local calendar day of the first occurrence. */
  day: DayKey;
  /** Local wall-clock 'HH:MM', or null for an all-day entry. */
  time: string | null;
  endTime: string | null;
  /** Every day this event falls on, first occurrence included. */
  days: DayKey[];
  /** True when the event repeated, so the UI can say "13 weeks" not "13 events". */
  repeats: boolean;
}

export interface ParseResult {
  events: ParsedEvent[];
  /** Human-readable reasons things were skipped. Shown, never swallowed. */
  skipped: string[];
}

/** How many occurrences a single rule may expand to. A term, generously. */
const MAX_OCCURRENCES = 60;

/**
 * Undoes the 75-octet line folding the format requires.
 *
 * Must run before anything else looks at a line. A folded DTSTART is not a
 * DTSTART as far as a naive parser is concerned, and this is the single most
 * common reason a hand-rolled reader silently drops half a feed.
 */
export function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  for (const line of raw) {
    // A continuation begins with a space or a tab, per the spec.
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** `DTSTART;TZID=America/Toronto:20260908T113000` → name, params, value. */
function splitLine(line: string): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;

  const left = line.slice(0, colon);
  const semi = left.indexOf(';');
  return {
    name: (semi === -1 ? left : left.slice(0, semi)).toUpperCase(),
    params: semi === -1 ? '' : left.slice(semi + 1).toUpperCase(),
    value: line.slice(colon + 1),
  };
}

/** ICS escaping, in reverse. Order matters: backslash last. */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

interface Stamp {
  day: DayKey;
  time: string | null;
}

/**
 * A DTSTART value into a local day and wall-clock time.
 *
 * A trailing Z means UTC and is converted; anything else — a TZID parameter or
 * a floating time — is taken at face value as local. That is the pragmatic
 * reading rather than the correct one, and it is stated here because it is the
 * assumption most likely to be wrong: a feed published in a zone other than
 * the reader's, without a Z, will be off by that difference. University
 * timetables publish in the university's zone, which is the zone of the person
 * attending, so in practice this holds.
 */
function parseStamp(value: string, zoneOffsetMinutes: number): Stamp | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;

  const [, y, mo, d, hh, mm, , z] = m;

  // Date-only: an all-day entry.
  if (hh === undefined) return { day: `${y}-${mo}-${d}` as DayKey, time: null };

  if (z) {
    const utc = Date.UTC(+y, +mo - 1, +d, +hh, +mm);
    const local = new Date(utc + zoneOffsetMinutes * 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      day: `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` as DayKey,
      time: `${p(local.getUTCHours())}:${p(local.getUTCMinutes())}`,
    };
  }

  return { day: `${y}-${mo}-${d}` as DayKey, time: `${hh}:${mm}` };
}

const BYDAY: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

/**
 * Expands a weekly RRULE into the days it lands on.
 *
 * Weekly only, and that is a deliberate stop rather than an unfinished bit.
 * A timetable is weekly; monthly and yearly rules in a course feed are
 * overwhelmingly one-off administrative entries, and a rule this cannot read
 * makes its event a single occurrence with a note rather than a wrong series.
 */
function expandWeekly(rule: string, first: Stamp, zoneOffsetMinutes: number): DayKey[] | null {
  const parts = new Map<string, string>();
  for (const p of rule.split(';')) {
    const [k, v] = p.split('=');
    if (k && v) parts.set(k.toUpperCase(), v.toUpperCase());
  }

  if (parts.get('FREQ') !== 'WEEKLY') return null;

  const interval = Math.max(1, Number(parts.get('INTERVAL') ?? '1') || 1);
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null;
  const untilRaw = parts.get('UNTIL');
  const until = untilRaw ? parseStamp(untilRaw, zoneOffsetMinutes)?.day ?? null : null;

  const wanted = (parts.get('BYDAY') ?? '')
    .split(',')
    .map((d) => BYDAY[d.trim()])
    .filter((n): n is number => Boolean(n));

  // No BYDAY means "the weekday the first occurrence falls on".
  const weekdays = wanted.length > 0 ? wanted : [isoWeekday(first.day)];

  const out: DayKey[] = [];
  // A bound even when the rule has neither COUNT nor UNTIL, which is legal and
  // means forever. Forever is not importable.
  const horizonDays = 7 * 53;

  for (let offset = 0; offset <= horizonDays; offset++) {
    const day = addDays(first.day, offset);
    if (until && day > until) break;

    // Which week of the pattern this is, for INTERVAL.
    const week = Math.floor(offset / 7);
    if (week % interval !== 0) continue;
    if (!weekdays.includes(isoWeekday(day))) continue;
    if (day < first.day) continue;

    out.push(day);
    if (count !== null && out.length >= count) break;
    if (out.length >= MAX_OCCURRENCES) break;
  }

  return out;
}

/**
 * Parses a calendar feed.
 *
 * `zoneOffsetMinutes` is the reader's offset from UTC, used only to convert
 * stamps that explicitly carry a Z. It is passed in rather than read from the
 * host so this stays pure and testable across zones.
 */
export function parseIcs(text: string, zoneOffsetMinutes = 0): ParseResult {
  const lines = unfold(text);
  const events: ParsedEvent[] = [];
  const skipped: string[] = [];

  let inEvent = false;
  let cur: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      cur = {};
      continue;
    }

    if (trimmed === 'END:VEVENT') {
      inEvent = false;

      const summary = unescapeText(cur.SUMMARY ?? '').trim();
      const startRaw = cur.DTSTART;

      if (!summary) {
        skipped.push('An event with no title.');
        continue;
      }
      if (!startRaw) {
        skipped.push(`"${summary}" has no start date.`);
        continue;
      }

      const start = parseStamp(startRaw, zoneOffsetMinutes);
      if (!start) {
        skipped.push(`"${summary}" has a start date this cannot read.`);
        continue;
      }

      const end = cur.DTEND ? parseStamp(cur.DTEND, zoneOffsetMinutes) : null;

      let days: DayKey[] = [start.day];
      let repeats = false;

      if (cur.RRULE) {
        const expanded = expandWeekly(cur.RRULE, start, zoneOffsetMinutes);
        if (expanded && expanded.length > 0) {
          days = expanded;
          repeats = expanded.length > 1;
        } else {
          // Read as a single occurrence and SAY SO, rather than inventing a
          // series from a rule that was not understood.
          skipped.push(`"${summary}" repeats in a way this cannot read. Imported once.`);
        }
      }

      events.push({
        uid: cur.UID ?? null,
        summary,
        location: cur.LOCATION ? unescapeText(cur.LOCATION).trim() || null : null,
        day: start.day,
        time: start.time,
        endTime: end?.time ?? null,
        days,
        repeats,
      });
      continue;
    }

    if (!inEvent) continue;

    const parsed = splitLine(line);
    if (!parsed) continue;

    // Only the fields this actually uses. Everything else — alarms,
    // organisers, attachments, categories — is ignored rather than
    // half-understood.
    if (['SUMMARY', 'DTSTART', 'DTEND', 'RRULE', 'UID', 'LOCATION'].includes(parsed.name)) {
      cur[parsed.name] = parsed.value;
    }
  }

  return { events, skipped };
}

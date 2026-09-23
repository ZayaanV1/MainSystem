import { localHourMinute } from './time';

/**
 * The arithmetic behind the Week view's block styles.
 *
 * Pure, and kept out of the components, because every one of these is a
 * place a calendar can be quietly wrong: a lecture drawn at the wrong height,
 * two overlapping events drawn on top of each other so one disappears, a gap
 * that says "free" across something that is actually booked.
 */

/* ============================================================================
   Reading a timetable title
   ========================================================================= */

export interface ReadTitle {
  /** What to lead with: "COEN 231 Lecture", or the title itself. */
  headline: string;
  /** "Section U", when the title carried one. */
  section: string | null;
  /** "MB S2.210", "Remote", or null when the title named no room (or TBA). */
  room: string | null;
  /** Lecture, tutorial, lab — when the title said which. */
  type: string | null;
  /** The course code as written in the title, normalised. */
  code: string | null;
}

const TYPES: Record<string, string> = {
  LEC: 'Lecture',
  TUT: 'Tutorial',
  LAB: 'Lab',
  SEM: 'Seminar',
  STU: 'Studio',
  WKS: 'Workshop',
  PRA: 'Practicum',
};

/*
 * University timetable exports pack four facts into one title, with the least
 * useful one first: "MB S2.210 - COEN 231-U - LEC" is a room, a course, a
 * section and a meeting type. Read left to right it starts with the room, which
 * is the last thing you need when scanning a week and the one fact the event's
 * location field already carries.
 *
 * So a title in exactly that shape is read apart and led with the course and
 * the kind of meeting. Anything that does not match EXACTLY is left as
 * written — a title the person typed is theirs, and rephrasing it is the
 * app rewriting their words on screen.
 */
const TIMETABLE =
  /^(.+?)\s+-\s+([A-Z]{3,4})\s?(\d{3})-([A-Z0-9]+(?:[\s-][A-Z0-9]+)*)\s+-\s+(LEC|TUT|LAB|SEM|STU|WKS|PRA)$/;

export function readTitle(title: string): ReadTitle {
  const m = TIMETABLE.exec(title.trim());
  if (!m) return { headline: title, section: null, room: null, type: null, code: null };

  const [, rawRoom, letters, digits, section, kind] = m;
  const code = `${letters} ${digits}`;
  const type = TYPES[kind];
  const roomWord = rawRoom.trim().toUpperCase();
  const room =
    roomWord === 'TBA' ? null : roomWord === 'REMOTE' || roomWord === 'ONLINE' ? 'Remote' : rawRoom.trim();

  return { headline: `${code} ${type}`, section: `Section ${section}`, room, type, code };
}

/* ============================================================================
   Minutes and durations
   ========================================================================= */

/** Minutes past local midnight, in the account's zone. */
export function minuteOfDay(instant: Date, tz?: string): number {
  const { hour, minute } = localHourMinute(instant, tz);
  return hour * 60 + minute;
}

/** "50 min", "1 h 15", "3 h". Compact, because it sits beside a time. */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/* ============================================================================
   Placing blocks on a time grid
   ========================================================================= */

export interface Span {
  id: string;
  /** Minutes past local midnight. */
  start: number;
  /** Minutes past local midnight, exclusive. Always > start. */
  end: number;
}

export interface Placed extends Span {
  /** Which column this block occupies within its cluster, from 0. */
  lane: number;
  /** How many columns its cluster needs. Width is 1 / lanes. */
  lanes: number;
}

/**
 * Side-by-side columns for overlapping events, the way every serious calendar
 * does it.
 *
 * Without this two events at the same time are drawn on top of each other and
 * one of them simply is not there — the worst failure a calendar has, because
 * it looks exactly like a free hour.
 *
 * Events are grouped into CLUSTERS of transitively overlapping spans, and each
 * cluster gets as many columns as its busiest moment needs. A block takes the
 * first free column. Keeping lanes per cluster rather than per day is what
 * stops one 9:00 clash from making every event at 16:00 half-width too.
 */
export function placeSpans(spans: Span[]): Placed[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];

  let cluster: Placed[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];

  const close = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const p of cluster) p.lanes = lanes;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const s of sorted) {
    if (s.start >= clusterEnd && cluster.length > 0) close();

    let lane = laneEnds.findIndex((end) => end <= s.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.end);
    } else {
      laneEnds[lane] = s.end;
    }

    cluster.push({ ...s, lane, lanes: 1 });
    clusterEnd = cluster.length === 1 ? s.end : Math.max(clusterEnd, s.end);
  }
  if (cluster.length > 0) close();

  return out;
}

/**
 * The hours a grid should show: from the top of the hour the earliest thing
 * starts in to the end of the hour the latest thing ends in, never less than
 * a working morning's worth.
 *
 * A fixed 00:00–24:00 grid on a phone is eight hours of empty scroll before the
 * first lecture. Fitting the range to the content is what makes a day grid
 * usable on a screen that is taller than it is wide.
 */
export function hourRange(
  minutes: number[],
  { minSpan = 4, fallback = [9, 17] as [number, number] } = {},
): [number, number] {
  if (minutes.length === 0) return fallback;
  let from = Math.floor(Math.min(...minutes) / 60);
  let to = Math.ceil(Math.max(...minutes) / 60);
  if (to <= from) to = from + 1;
  while (to - from < minSpan) {
    if (to < 24) to += 1;
    if (to - from < minSpan && from > 0) from -= 1;
    if (from === 0 && to === 24) break;
  }
  return [Math.max(0, from), Math.min(24, to)];
}

/**
 * Free time between consecutive timed things, when there is enough of it to
 * matter.
 *
 * Measured against the latest end seen so far rather than the previous block's
 * end, or a long lab followed by a short overlapping meeting would report the
 * lab's remaining hour as free.
 */
export function freeGaps(spans: Span[], minimum = 20): { after: string; minutes: number }[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: { after: string; minutes: number }[] = [];
  let reach = -Infinity;
  let lastId: string | null = null;

  for (const s of sorted) {
    if (lastId !== null && s.start - reach >= minimum) {
      out.push({ after: lastId, minutes: s.start - reach });
    }
    if (s.end >= reach) {
      reach = s.end;
      lastId = s.id;
    }
  }
  return out;
}

/** How far through a span `now` is, 0 to 1, or null when it is not under way. */
export function progressThrough(start: Date, end: Date | null, now: Date): number | null {
  if (!end) return null;
  const t = now.getTime();
  const a = start.getTime();
  const b = end.getTime();
  if (b <= a || t < a || t >= b) return null;
  return (t - a) / (b - a);
}

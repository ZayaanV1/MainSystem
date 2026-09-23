import type { FeedInstance } from './feed.ts';

/**
 * Turning a freshly read feed into the smallest set of database changes.
 *
 * A sync is a DIFF, never a delete-and-reinsert. Replacing everything on each
 * refresh would give every mirrored event a new id every five minutes — any
 * link to one breaks, "what changed" becomes unanswerable, and a refresh that
 * failed halfway would leave the calendar empty rather than stale.
 *
 * An occurrence's identity is its UID and its start. A recurring meeting
 * shares one UID across every week, so the UID alone identifies a series,
 * not an event.
 */

/** A mirrored event as the sync reads it back. */
export interface MirrorRow {
  id: string;
  feed_uid: string | null;
  starts_at: string;
  ends_at: string | null;
  title: string;
  location: string | null;
  all_day: boolean;
  course_id: string | null;
  kind: string;
}

/** A parsed occurrence plus what the sync worked out about it. */
export type MirrorInstance = FeedInstance & { courseId: string | null; kind: EventKind };

export interface MirrorPatch {
  id: string;
  title: string;
  location: string | null;
  ends_at: string | null;
  all_day: boolean;
  course_id: string | null;
  kind: string;
}

export interface MirrorDiff {
  insert: MirrorInstance[];
  update: MirrorPatch[];
  /** Row ids. */
  remove: string[];
}

/**
 * Timestamps compare as instants, never as strings. Postgres hands back
 * `2026-09-15T14:00:00+00:00` for the value JavaScript wrote as
 * `2026-09-15T14:00:00.000Z`; compared as text, every row would look changed
 * on every sync and the diff would rewrite the whole calendar each time.
 */
function ms(iso: string | null): number | null {
  return iso === null ? null : Date.parse(iso);
}

function identity(uid: string | null, startsAt: string): string {
  return `${uid ?? ''}|${ms(startsAt)}`;
}

export function diffMirror(existing: MirrorRow[], incoming: MirrorInstance[]): MirrorDiff {
  const have = new Map<string, MirrorRow>();
  const remove: string[] = [];

  for (const row of existing) {
    const k = identity(row.feed_uid, row.starts_at);
    // Two rows with one identity cannot come from a sync — the index forbids
    // it — but if one ever exists, keeping the first and removing the rest
    // repairs it rather than preserving it forever.
    if (have.has(k)) remove.push(row.id);
    else have.set(k, row);
  }

  const insert: MirrorInstance[] = [];
  const update: MirrorPatch[] = [];
  const seen = new Set<string>();

  for (const inst of incoming) {
    const k = identity(inst.uid, inst.startsAt);
    if (seen.has(k)) continue;
    seen.add(k);

    const row = have.get(k);
    if (!row) {
      insert.push(inst);
      continue;
    }

    const changed =
      row.title !== inst.title ||
      (row.location ?? null) !== inst.location ||
      row.all_day !== inst.allDay ||
      ms(row.ends_at) !== ms(inst.endsAt) ||
      (row.course_id ?? null) !== inst.courseId ||
      row.kind !== inst.kind;

    if (changed) {
      update.push({
        id: row.id,
        title: inst.title,
        location: inst.location,
        ends_at: inst.endsAt,
        all_day: inst.allDay,
        course_id: inst.courseId,
        kind: inst.kind,
      });
    }
  }

  // Whatever the feed no longer mentions — deleted, moved, or slid out of the
  // window — goes. A mirror that kept it would show a meeting that was
  // cancelled with the same confidence as one that was not.
  for (const [k, row] of have) {
    if (!seen.has(k)) remove.push(row.id);
  }

  return { insert, update, remove };
}

/**
 * Rows for a bulk insert, every key present on every row.
 *
 * PostgREST rejects a bulk insert whose objects have differing key sets
 * (PGRST102), and it rejects the WHOLE batch. It has cost this project a
 * silently short meal and a failed seed already, so the shape is fixed here
 * rather than left to whoever calls it.
 */
export function mirrorInsertRows(instances: MirrorInstance[], userId: string, feedId: string) {
  return instances.map((i) => ({
    user_id: userId,
    feed_id: feedId,
    feed_uid: i.uid,
    title: i.title,
    kind: i.kind,
    starts_at: i.startsAt,
    ends_at: i.endsAt,
    all_day: i.allDay,
    location: i.location,
    course_id: i.courseId,
    notes: null,
  }));
}

/**
 * A canonical description of what a feed puts on the calendar, for hashing.
 *
 * Fingerprinting the RAW BODY failed twice against real Google feeds. Google
 * rewrites DTSTAMP on every event on every download, which stripping DTSTAMP
 * fixed for a public calendar — and then a private primary calendar still
 * never hashed the same twice, differing between downloads in some other way
 * that did not change a single event. Chasing each provider's volatile bytes
 * is a losing game.
 *
 * So the fingerprint is of the PARSED RESULT instead: the occurrences in the
 * window and what the reader could not read. Nothing that does not change the
 * calendar can change this, whatever the provider does to its bytes; anything
 * that does change the calendar — including the window sliding past a day —
 * must. Parsing is cheap now; the saving that matters is skipping the read of
 * every mirrored row and the diff, which is what this lets an unchanged sync
 * do.
 *
 * Sorted on the full line, so two parses of the same calendar agree even if
 * the provider emitted the events in a different order.
 */
export function fingerprintInstances(instances: FeedInstance[], problems: string[]): string {
  const lines = instances.map((i) =>
    [i.uid, Date.parse(i.startsAt), i.endsAt ? Date.parse(i.endsAt) : '', i.allDay ? 1 : 0, i.title, i.location ?? ''].join('\u001f'),
  );
  lines.sort();
  return [...lines, '--', ...[...problems].sort()].join('\n');
}

/* ============================================================================
   Reading what a mirrored event IS
   ========================================================================= */

export type EventKind = 'exam' | 'lab' | 'other';

/**
 * The course code in an event's title, normalised — "MATH 205".
 *
 * University timetables write the code into every title ("H435 - MATH 205-J -
 * LEC", "MB S2.210 - COEN 231-U - LEC"), and so do most platforms' deadline
 * events ("PHYS 205 - Quiz #3 is due"). Three or four capitals, then three
 * digits. Room codes like "H435" and "FB S150" fall short of the letters, and
 * a lowercase "205" in prose is not a course.
 */
export function courseCodeOf(title: string): string | null {
  const m = /\b([A-Z]{3,4})\s?-?\s?(\d{3})(?!\d)/.exec(title);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** "COEN212", "coen 212", "COEN-212" all compare equal. */
export function normaliseCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const m = /([A-Za-z]{3,4})\s*-?\s*(\d{3})/.exec(code);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : null;
}

/**
 * Exam, lab, or neither — from the title alone.
 *
 * Deliberately narrow. "Exam" matters because exams get the reminder the night
 * before, and marking a mirrored "Midterm Exam" as one is the difference
 * between that reminder existing and not. Anything that merely MENTIONS an
 * exam — practice problems, a sample paper, a deadline — is not an exam, and
 * calling it one would send a false night-before warning.
 */
export function kindOf(title: string): EventKind {
  if (/\b(midterm|final exam|exam|test)\b/i.test(title) &&
      !/\b(practice|sample|due|available|seat|registration|deadline|accommodation)/i.test(title)) {
    return 'exam';
  }
  // Timetable exports mark lab sections with a standalone LAB, in capitals.
  if (/(^|[\s-])LAB\b/.test(title)) return 'lab';
  return 'other';
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'due', 'is', 'are', 'available']);

function tokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const w of title.toLowerCase().match(/[a-z]+|\d+/g) ?? []) {
    if (/^\d+$/.test(w) || (w.length >= 4 && !STOP.has(w))) out.add(w);
  }
  return out;
}

/**
 * Whether a mirrored occurrence is something the app already shows.
 *
 * The same instant AND a shared meaningful word. "PHYS 205 - Quiz #3 is due"
 * at Sat 23:59 and a piece of work "Quiz 3" due Sat 23:59 are one fact; showing
 * both makes the calendar read as twice as busy as it is. The instant alone is
 * not enough — a 14:00 lecture and a 14:00 exam are different things — and the
 * word alone is not enough either, or every "Assignment 2" in every course
 * would collide.
 *
 * Only ever HIDES a copy. If the source later moves the deadline, the instants
 * stop matching and the mirrored event reappears beside the work, which is
 * exactly how the move gets noticed.
 */
export function duplicatesTracked(
  inst: { startsAt: string; title: string },
  tracked: { at: string; title: string }[],
): boolean {
  const at = Date.parse(inst.startsAt);
  const mine = tokens(inst.title);
  return tracked.some((t) => {
    if (Math.abs(Date.parse(t.at) - at) > 60_000) return false;
    for (const w of tokens(t.title)) if (mine.has(w)) return true;
    return false;
  });
}

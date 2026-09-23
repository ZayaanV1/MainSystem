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
}

export interface MirrorPatch {
  id: string;
  title: string;
  location: string | null;
  ends_at: string | null;
  all_day: boolean;
}

export interface MirrorDiff {
  insert: FeedInstance[];
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

export function diffMirror(existing: MirrorRow[], incoming: FeedInstance[]): MirrorDiff {
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

  const insert: FeedInstance[] = [];
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
      ms(row.ends_at) !== ms(inst.endsAt);

    if (changed) {
      update.push({
        id: row.id,
        title: inst.title,
        location: inst.location,
        ends_at: inst.endsAt,
        all_day: inst.allDay,
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
export function mirrorInsertRows(instances: FeedInstance[], userId: string, feedId: string) {
  return instances.map((i) => ({
    user_id: userId,
    feed_id: feedId,
    feed_uid: i.uid,
    title: i.title,
    kind: 'other',
    starts_at: i.startsAt,
    ends_at: i.endsAt,
    all_day: i.allDay,
    location: i.location,
    course_id: null,
    notes: null,
  }));
}

/**
 * The part of a feed that says what is ON the calendar, for fingerprinting.
 *
 * Google writes the time of the download into every event's DTSTAMP, on
 * every download. Verified against a live Google feed: two copies fetched
 * four seconds apart differ in exactly one property, DTSTAMP, on all 433
 * events — so a hash of the raw body never matched twice, and every
 * five-minute sync fully re-parsed and re-diffed a calendar that had not
 * changed at all.
 *
 * DTSTAMP describes the export, not the event, and the reader never looks at
 * it. Everything else stays in, so any real change still changes the hash.
 */
export function fingerprintSource(text: string): string {
  return text.replace(/^DTSTAMP[:;][^\r\n]*(?:\r?\n)?/gim, '');
}

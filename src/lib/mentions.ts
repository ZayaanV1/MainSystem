import { formatRoute } from './route';
import { localDayKey, type DayKey } from './time';

/**
 * Turning the titles in a sentence into links.
 *
 * Abood's replies and the morning briefing are prose that names work and exams
 * ("your lab report is due Thursday"). The name is the one thing in it that
 * can be acted on, so it is a link to the thing itself: a piece of work opens
 * its page, an exam opens its day.
 *
 * Matching is by title against what the app already holds, never by asking the
 * model to emit links. A model that writes the link can write a wrong one;
 * matching against the real rows can only link to something that exists, and a
 * title it paraphrased simply stays plain text.
 */

export interface Mention {
  title: string;
  href: string;
  kind: 'work' | 'event';
}

export type Piece = { text: string; mention?: Mention };

/** The address of a piece of work's page. */
export const workHref = (id: string) => formatRoute({ screen: 'work', item: id });

/** The address of the day an event falls on, in Month. */
export const dayHref = (day: DayKey) => formatRoute({ screen: 'month', day });

const MIN_TITLE = 3;

// Same length in, same length out, so positions found in the folded copy are
// positions in the original.
const fold = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();

const isWordChar = (ch: string | undefined) => (ch ? /[\p{L}\p{N}]/u.test(ch) : false);

/**
 * Split a sentence into plain pieces and mentions.
 *
 * Longest title first, so "Lab report 2" wins over "Lab report"; a title is
 * linked only as a whole word run, so "Essay" does not light up inside
 * "essays"; and a stretch is claimed once, by whichever title got there first.
 */
export function splitMentions(text: string, mentions: Mention[]): Piece[] {
  const haystack = fold(text);
  const claimed: { start: number; end: number; mention: Mention }[] = [];

  const ordered = [...mentions]
    .filter((m) => m.title.trim().length >= MIN_TITLE)
    .sort((a, b) => b.title.length - a.title.length);

  for (const mention of ordered) {
    const needle = fold(mention.title.trim());
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      const end = at + needle.length;
      from = end;
      if (isWordChar(haystack[at - 1]) || isWordChar(haystack[end])) continue;
      if (claimed.some((c) => at < c.end && end > c.start)) continue;
      claimed.push({ start: at, end, mention });
    }
  }

  claimed.sort((a, b) => a.start - b.start);
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const c of claimed) {
    if (c.start > cursor) pieces.push({ text: text.slice(cursor, c.start) });
    pieces.push({ text: text.slice(c.start, c.end), mention: c.mention });
    cursor = c.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor) });
  return pieces.length ? pieces : [{ text }];
}

/**
 * Go to an address inside the app without reloading it.
 *
 * The shell owns the screen, so a link anywhere asks it to move rather than
 * pushing history itself; it handles this the way it handles a tapped
 * notification.
 */
export const GOTO_EVENT = 'planner:goto';

export function goTo(href: string): void {
  window.dispatchEvent(new CustomEvent(GOTO_EVENT, { detail: href }));
}

/**
 * The names the app can link: open work to its page, and events to their day.
 *
 * Finished work is left out, because a sentence that names it ("you finished
 * the lab report") is not pointing at anything to act on. Events keep their
 * day rather than a page of their own: an exam has nothing more to it than
 * its time and place, which Month shows.
 */
export function mentionsFrom(
  work: readonly { id: string; title: string; status: string }[],
  events: readonly { title: string; starts_at: string }[],
): Mention[] {
  return [
    ...work
      .filter((w) => w.status !== 'done')
      .map((w): Mention => ({ title: w.title, href: workHref(w.id), kind: 'work' })),
    ...events.map((e): Mention => ({ title: e.title, href: dayHref(localDayKey(new Date(e.starts_at))), kind: 'event' })),
  ];
}

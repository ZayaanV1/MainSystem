/**
 * Making a message fit the channel it is going to.
 *
 * THE BUG THIS EXISTS FOR
 *
 * A morning digest for an account with 24 open assignments came to 4,239
 * characters. Telegram refuses a message over 4,096 characters ("message is too
 * long") and Web Push refuses an encrypted payload over 4,096 bytes (HTTP 413).
 * Both channels failed, so the digest reached nobody, and the scheduler retried
 * the identical message every 15 minutes for the rest of the day. Silence from
 * a notification reads as "nothing is due", which is the one wrong answer this
 * app must never give.
 *
 * Nothing capped the digest because the digest builder knows nothing about
 * channels, which is the right separation. So the cap lives here, applied
 * where the channel is known, and the digest builder offers a compact form for
 * the channel that needs one.
 *
 * WHAT GETS CUT
 *
 * Whole items, lowest priority first, and the cut says how many: "and 9 more".
 * Silently dropping the tail would make a long day look like a short one. The
 * checklist for today is cut last of the lists, because it is what you act on
 * before you have opened anything.
 */

/** Telegram's limit is 4,096 characters; this leaves room for the link and title. */
export const TELEGRAM_MAX_CHARS = 3800;

/**
 * A push payload is encrypted into one 4,096-byte record with about a hundred
 * bytes of overhead, and carries a title and a link beside the body. A
 * notification shows a few lines anyway, so the body is kept far under what
 * would fit; the full text is on Telegram and in the app.
 */
export const PUSH_MAX_BODY_BYTES = 1100;
export const PUSH_MAX_TITLE_BYTES = 120;
export const PUSH_MAX_LINK_BYTES = 400;

/** The size the full digest is held to, for channels that can carry it. */
export const FULL_DIGEST_MAX_CHARS = 3000;

const encoder = new TextEncoder();

export const byteLength = (s: string): number => encoder.encode(s).length;

/**
 * Cut text to a size, at a line break, never inside a character, and say how
 * much was left out.
 */
export function clampText(
  text: string,
  max: number,
  unit: 'chars' | 'bytes',
  trailer: (omittedLines: number) => string = (n) => `and ${n} more in the app`,
): string {
  const size = (s: string) => (unit === 'bytes' ? byteLength(s) : s.length);
  if (size(text) <= max) return text;

  const lines = text.split('\n');
  const kept: string[] = [];
  let used = 0;

  for (let i = 0; i < lines.length; i++) {
    const omitted = lines.length - i;
    const reserve = size(`\n${trailer(omitted)}`);
    const next = used + size(lines[i]) + (kept.length ? 1 : 0);
    if (next + reserve > max) break;
    kept.push(lines[i]);
    used = next;
  }

  if (kept.length === 0) {
    // One line longer than the whole allowance: cut inside it, on a character.
    const room = Math.max(1, max - size('…'));
    let out = '';
    for (const ch of lines[0]) {
      if (size(out + ch) > room) break;
      out += ch;
    }
    return `${out}…`;
  }

  const omitted = lines.length - kept.length;
  const nonEmpty = lines.slice(kept.length).filter((l) => l.trim()).length;
  return `${kept.join('\n').trimEnd()}\n${trailer(Math.max(1, nonEmpty || omitted))}`;
}

/** Cut a single string to a byte length on a character boundary. */
export function clampBytes(text: string, max: number): string {
  if (byteLength(text) <= max) return text;
  let out = '';
  for (const ch of text) {
    if (byteLength(out + ch) > max - 3) break;
    out += ch;
  }
  return `${out}…`;
}

export type SectionKind = 'overdue' | 'due' | 'events' | 'today';

export interface FitSection {
  kind: SectionKind;
  heading: string;
  items: string[];
}

/** Which list gives up items first. Today's checklist is the last to shrink. */
const SHRINK_ORDER: SectionKind[] = ['events', 'due', 'overdue', 'today'];

/** The number of items hidden behind "and N more" in one section. */
const more = (n: number) => `and ${n} more`;

const renderSections = (sections: FitSection[], keeps: Map<FitSection, number>): string =>
  sections
    .map((s) => {
      const keep = keeps.get(s) ?? s.items.length;
      const shown = s.items.slice(0, keep);
      const hidden = s.items.length - keep;
      return [s.heading, ...shown.map((i) => `- ${i}`), ...(hidden > 0 ? [`- ${more(hidden)}`] : [])].join('\n');
    })
    .join('\n\n');

/**
 * Render the sections within a budget by shrinking the lowest-priority lists
 * first. Each list keeps at least one item and says how many it hid. If that is
 * still over, the caller's clamp is the last resort.
 */
export function fitSections(
  sections: FitSection[],
  max: number,
  unit: 'chars' | 'bytes',
): string {
  const size = (s: string) => (unit === 'bytes' ? byteLength(s) : s.length);
  const keeps = new Map<FitSection, number>(sections.map((s) => [s, s.items.length]));

  for (const kind of SHRINK_ORDER) {
    for (const s of sections.filter((x) => x.kind === kind)) {
      while (size(renderSections(sections, keeps)) > max && (keeps.get(s) ?? 0) > 1) {
        keeps.set(s, (keeps.get(s) ?? 1) - 1);
      }
    }
    if (size(renderSections(sections, keeps)) <= max) break;
  }

  return renderSections(sections, keeps);
}

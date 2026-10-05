/**
 * What was opened recently, on this device.
 *
 * Search offers it when the box is empty: the thing you opened an hour ago is
 * the likeliest thing to want again. Kept in local storage and never synced —
 * it is a convenience of this screen, not a record of anything — and bounded
 * to six, so it is a shortcut rather than a history.
 */

export interface Opened {
  id: string;
  title: string;
}

const KEY = 'planner.recent';
const KEEP = 6;

export function readRecent(): Opened[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter((o): o is Opened => typeof o?.id === 'string' && typeof o?.title === 'string').slice(0, KEEP)
      : [];
  } catch {
    return [];
  }
}

/** Most recent first, each piece of work once. */
export function rememberOpened(item: Opened): void {
  try {
    const next = [item, ...readRecent().filter((o) => o.id !== item.id)].slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage refused: Search simply has nothing recent to offer.
  }
}

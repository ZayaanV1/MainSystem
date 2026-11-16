import type { CheckinSettings } from './abood';
import type { DigestSettings } from './planner';
import type { Preferences } from './preferences';
import type { ThemeChoice } from './theme';

/**
 * The value each Settings row shows, in a word or two.
 *
 * The rows used to carry a whole sentence each ("Push not available here ·
 * digest 7:00 a.m. · weekly…"), which ran to an ellipsis on a phone and made
 * the root a page to read. A row now says the one thing it is set to and its
 * page says the rest (15 Nov 2026). Null while a value is still loading: a
 * row says nothing rather than something it has not checked.
 */

/** A whole hour as the app says it. 24 is how "until midnight" is stored; it once read as 12:00 p.m. */
export function clock(h: number, m = 0): string {
  if (m === 0 && h === 12) return 'noon';
  if (m === 0 && h % 24 === 0) return 'midnight';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h % 24 < 12 ? 'a.m.' : 'p.m.'}`;
}

const MODE: Record<ThemeChoice, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };
const LOOK: Record<string, string> = { glass: 'Glass', dots: 'Dot matrix', riso: 'Risograph', flap: 'Split-flap' };

/** "Glass · Dark". `look` is the root's data-look, absent for Plain. */
export function lookValue(look: string | undefined, mode: ThemeChoice): string {
  return `${LOOK[look ?? ''] ?? 'Plain'} · ${MODE[mode]}`;
}

/** When the digest arrives, or that it does not. */
export function notificationsValue(digest: DigestSettings | null): string | null {
  if (!digest) return null;
  return digest.digest_enabled ? clock(digest.digest_hour, digest.digest_minute) : 'Off';
}

/** How Today and the modules differ from the usual, if they do. */
export function featuresValue(prefs: Pick<Preferences, 'hidden' | 'modulesOff'>): string {
  const off = prefs.hidden.length + prefs.modulesOff.length;
  return off ? `${off} off` : 'All on';
}

/** The city of the account's zone: "America/Toronto" is "Toronto". */
export function accountValue(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/** When Abood may text first, for its own row. */
export function textsFirstValue(checkins: CheckinSettings | null): string | null {
  if (!checkins) return null;
  return checkins.on ? `${clock(checkins.from)} to ${clock(checkins.until)}` : 'Off';
}

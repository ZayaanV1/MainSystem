import type { Appearance } from './appearance';
import type { CheckinSettings } from './abood';
import type { DigestSettings } from './planner';
import type { PushStatus } from './notifications';
import type { ThemeChoice } from './theme';

/**
 * The value each Settings row shows.
 *
 * Settings was fourteen sections in one 5,600 px page, and finding what was
 * set meant reading all of it. Grouped into rows that open their own pages,
 * each row says what it currently is, so most visits end on the first screen.
 * Null while a value is still loading: a row says nothing rather than
 * something it has not checked.
 */

const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const clock = (h: number, m: number) => {
  if (h === 12 && m === 0) return 'noon';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
};

const PUSH_SHORT: Record<PushStatus, string> = {
  unsupported: 'Push not available here',
  'needs-install': 'Add to the home screen for push',
  'needs-permission': 'Push off on this device',
  denied: 'Notifications blocked',
  'no-service-worker': 'Push not set up',
  'device-only': 'Push needs registering',
  subscribed: 'Push on',
};

export function notificationsSummary(push: PushStatus | null, digest: DigestSettings | null): string | null {
  if (!push && !digest) return null;
  return [
    push ? PUSH_SHORT[push] : null,
    digest ? (digest.digest_enabled ? `digest ${clock(digest.digest_hour, digest.digest_minute)}` : 'digest off') : null,
    digest?.weekly_review_enabled ? `weekly review ${WEEKDAY[digest.weekly_review_weekday] ?? ''}`.trim() : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const THEME: Record<ThemeChoice, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };

export function appearanceSummary(theme: ThemeChoice, a: Appearance): string {
  return [
    THEME[theme],
    a.slip === 'ticket' ? 'ticket slips' : 'glass slips',
    a.glass === 'off' ? 'no glass' : a.glass === 'bars' ? 'glass on bars' : 'glass everywhere',
    a.motion === 'full' ? 'full motion' : 'calm motion',
  ].join(' · ');
}

const hour = (h: number) => clock(h, 0);

export function aboodSummary(
  keys: { groq: boolean; gemini: boolean } | null,
  telegram: boolean | null,
  checkins: CheckinSettings | null,
): string | null {
  if (!keys && telegram === null && !checkins) return null;
  return [
    keys ? (keys.groq || keys.gemini ? `${[keys.groq ? 'Groq' : null, keys.gemini ? 'Gemini' : null].filter(Boolean).join(' and ')} key set` : 'shared model') : null,
    telegram === null ? null : telegram ? 'Telegram linked' : 'Telegram not linked',
    checkins ? (checkins.on ? `texts first ${hour(checkins.from)} to ${hour(checkins.until)}` : 'never texts first') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

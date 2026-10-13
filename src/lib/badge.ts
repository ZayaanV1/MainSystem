import type { Assignment } from './planner';
import { localDayKey, type DayKey } from './time';

/**
 * The number on the home-screen icon: what is due today and still open.
 *
 * Today only, never overdue. A count that includes overdue work only grows
 * with what was missed and never falls on its own, which is a streak counter
 * in reverse and exactly what rule 3 forbids. Today's count falls to nothing
 * as the day is done, and resets every morning.
 *
 * The Badging API exists for installed web apps (iOS 16.4 and later, Chrome
 * and Edge on desktop). Where it does not, this does nothing.
 */

const KEY = 'planner.badge';

export function badgeCount(assignments: Assignment[], today: DayKey): number {
  return assignments.filter((a) => a.status !== 'done' && a.due_at && localDayKey(new Date(a.due_at)) === today).length;
}

/** Per device, because the icon is. On unless switched off. */
export function badgeOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setBadgeOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Not fatal: the icon just keeps doing what it did.
  }
  if (!on) void applyBadge(0);
}

export const badgeSupported = () => typeof navigator !== 'undefined' && 'setAppBadge' in navigator;

export async function applyBadge(count: number): Promise<void> {
  if (!badgeSupported()) return;
  const nav = navigator as Navigator & { setAppBadge(n?: number): Promise<void>; clearAppBadge(): Promise<void> };
  try {
    if (count > 0 && badgeOn()) await nav.setAppBadge(count);
    else await nav.clearAppBadge();
  } catch {
    // Refused (not installed, or no permission to notify): nothing to show.
  }
}

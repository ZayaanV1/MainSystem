import { beforeEach } from 'vitest';
import { setActiveTimezone } from '../src/lib/time';

/**
 * A minimal localStorage, because the suite runs on `environment: 'node'`.
 *
 * Switching the whole suite to jsdom for this would be the obvious move and
 * the wrong one: the node environment is a deliberate choice documented below,
 * and jsdom brings a great deal of DOM this project does not test through.
 *
 * The app's use of storage is genuinely this simple — string keys, string
 * values, three call sites — so a real implementation buys nothing a Map does
 * not. What it DOES buy is that the theme preference and the focus timer
 * become testable at all, and both are features whose entire job is surviving
 * a reload.
 *
 * Reset between tests, or a session started in one leaks into the next.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}

/**
 * Pins the account timezone for the suite.
 *
 * The client time layer defaults to the BROWSER's zone, which is right for a
 * product with users in many cities and wrong for a test run, where it would
 * mean every date assertion silently depends on the machine the suite happens
 * to be on. `npm run test:tz` runs the whole suite under five hostile host
 * zones precisely to catch code that reads the host clock, and that check is
 * only meaningful if the tests themselves do not move with it.
 *
 * America/Toronto because that is the zone every existing expectation was
 * written against, and because it has a DST rule that differs from Europe's,
 * so a fixture crossing a boundary stays a real test rather than a lucky one.
 *
 * A test that is about another zone sets it explicitly and says so.
 */
beforeEach(() => {
  setActiveTimezone('America/Toronto');
  localStorage.clear();
});

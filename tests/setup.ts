import { beforeEach } from 'vitest';
import { setActiveTimezone } from '../src/lib/time';

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
});

import { describe, it, expect } from 'vitest';
import { ageLabel } from './readcache';

/**
 * The cache's user-facing half.
 *
 * The storage half needs a real IndexedDB and is exercised by the app rather
 * than here; this is the part that decides what the banner SAYS, and a wrong
 * label is how a cached day quietly reads as a live one.
 */
describe('ageLabel', () => {
  const at = Date.UTC(2026, 8, 8, 12, 0, 0);
  const after = (mins: number) => ageLabel(at, at + mins * 60_000);

  it('does not pretend to precision it does not have', () => {
    expect(after(0)).toBe('a moment ago');
    expect(after(0.5)).toBe('a moment ago');
  });

  it('reads naturally at the singular boundary', () => {
    expect(after(1)).toBe('1 minute ago');
    expect(after(2)).toBe('2 minutes ago');
    expect(after(60)).toBe('1 hour ago');
    expect(after(120)).toBe('2 hours ago');
  });

  it('switches to hours rather than counting to 300 minutes', () => {
    expect(after(59)).toBe('59 minutes ago');
    expect(after(61)).toBe('1 hour ago');
    expect(after(305)).toBe('5 hours ago');
  });

  it('never renders a negative age from a clock that moved backwards', () => {
    // A device whose clock corrects itself backwards would otherwise produce
    // "-3 minutes ago", which reads as a bug in the data rather than the clock.
    expect(ageLabel(at, at - 60_000)).toBe('a moment ago');
  });
});

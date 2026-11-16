import { describe, expect, it } from 'vitest';
import { isSensitive } from './abood';

describe('what counts as sensitive in Abood’s memory', () => {
  it.each([
    'Has ADHD and works best with short deadlines.',
    'Takes medication in the morning.',
    'Has a clinic appointment on the 30th.',
    'Rent is tight until the next pay day.',
    'Broke up with a girlfriend in October.',
    'Wants to cut back on drinking.',
  ])('keeps "%s" only when the switch is on', (fact) => {
    expect(isSensitive(fact)).toBe(true);
  });

  it.each([
    'Prefers to study in the library after 2.',
    'Lab partner for COEN 212 is Sam.',
    'Finds 8:45 lectures hard to get to.',
    'Works at the library on Saturday mornings.',
    'Stayed up late finishing the lab report during exam period.',
  ])('always keeps "%s"', (fact) => {
    expect(isSensitive(fact)).toBe(false);
  });
});

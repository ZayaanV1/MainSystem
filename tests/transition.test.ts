import { describe, it, expect } from 'vitest';
import { directionBetween } from '../src/lib/transition';

/**
 * Direction is read off the nav order, and getting it wrong does not throw —
 * it produces a screen sliding the wrong way, which reads as a rendering
 * glitch rather than as a logic error. That is precisely the class of bug this
 * project keeps catching by asserting the arithmetic instead of watching the
 * result.
 */

const NAV = ['today', 'week', 'month', 'plan', 'food', 'ask'] as const;

describe('which way a screen travels', () => {
  it('moves forward down the nav order', () => {
    expect(directionBetween(NAV, 'today', 'week')).toBe('forward');
    expect(directionBetween(NAV, 'today', 'ask')).toBe('forward');
    expect(directionBetween(NAV, 'month', 'plan')).toBe('forward');
  });

  it('moves back up the nav order', () => {
    expect(directionBetween(NAV, 'week', 'today')).toBe('back');
    expect(directionBetween(NAV, 'ask', 'today')).toBe('back');
    expect(directionBetween(NAV, 'plan', 'month')).toBe('back');
  });

  it('is symmetric, so a journey and its return mirror exactly', () => {
    // If these ever disagree, going back would not undo going forward and the
    // pair would read as two unrelated movements.
    for (const a of NAV) {
      for (const b of NAV) {
        if (a === b) continue;
        const there = directionBetween(NAV, a, b);
        const back = directionBetween(NAV, b, a);
        expect(there).not.toBe(back);
      }
    }
  });

  it('claims no direction for a screen with no place in the nav', () => {
    // Search and the settings screen are reached from a menu or a shortcut,
    // not from the bar. They have no position in the sequence, so sliding them
    // would assert a spatial relationship that does not exist.
    expect(directionBetween(NAV, 'today', 'search' as never)).toBe('none');
    expect(directionBetween(NAV, 'search' as never, 'today')).toBe('none');
    expect(directionBetween(NAV, 'search' as never, 'settings' as never)).toBe('none');
  });

  it('claims no direction for a screen to itself', () => {
    // Re-tapping the current tab must not run a transition over an unchanged
    // page, which would flash the whole screen for nothing.
    for (const s of NAV) expect(directionBetween(NAV, s, s)).toBe('none');
  });

  it('survives an empty order', () => {
    expect(directionBetween([], 'today', 'week')).toBe('none');
  });
});

import { describe, it, expect } from 'vitest';
import { DEFAULT_APPEARANCE, parseAppearance } from './appearance';

describe('parseAppearance', () => {
  it('draws work as list rows by default', () => {
    expect(parseAppearance(null).slip).toBe('list');
    expect(DEFAULT_APPEARANCE.slip).toBe('list');
  });

  it('moves a value saved before the list existed onto the list, keeping its other choices', () => {
    const old = JSON.stringify({ slip: 'ticket', glass: 'off', animatedBlur: false, motion: 'calm' });
    expect(parseAppearance(old)).toEqual({ slip: 'list', glass: 'off', animatedBlur: false, motion: 'calm', tabs: 'quick' });
  });

  it('keeps a slip chosen since', () => {
    const chosen = JSON.stringify({ slip: 'ticket', glass: 'bars', animatedBlur: false, motion: 'full', version: 2 });
    expect(parseAppearance(chosen).slip).toBe('ticket');
  });

  it('switches screens quickly by default and keeps a slide chosen since', () => {
    expect(DEFAULT_APPEARANCE.tabs).toBe('quick');
    expect(parseAppearance(JSON.stringify({ tabs: 'slide', version: 2 })).tabs).toBe('slide');
    expect(parseAppearance('{"tabs":"fade","version":2}').tabs).toBe('quick');
  });

  it('falls back on anything unknown or corrupt', () => {
    expect(parseAppearance('{"slip":"cards","version":2}').slip).toBe('list');
    expect(parseAppearance('not json')).toEqual(DEFAULT_APPEARANCE);
  });
});

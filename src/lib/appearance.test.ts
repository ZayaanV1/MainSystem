import { describe, it, expect } from 'vitest';
import { DEFAULT_APPEARANCE, parseAppearance } from './appearance';

describe('parseAppearance', () => {
  it('draws work as list rows by default', () => {
    expect(parseAppearance(null).slip).toBe('list');
    expect(DEFAULT_APPEARANCE.slip).toBe('list');
  });

  it('moves a value saved before the list existed onto the list, keeping its other choices', () => {
    const old = JSON.stringify({ slip: 'ticket', glass: 'off', animatedBlur: false, motion: 'calm' });
    expect(parseAppearance(old)).toEqual({ ...DEFAULT_APPEARANCE, slip: 'list', glass: 'off', animatedBlur: false, motion: 'calm' });
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

  it('keeps no motion at all when chosen', () => {
    expect(parseAppearance('{"motion":"none","version":2}').motion).toBe('none');
  });

  it('keeps Vision\'s glass settings on their steps, and drops anything off them', () => {
    const v = parseAppearance(
      JSON.stringify({ visionClear: 80, visionBlur: 12, visionDim: 35, visionBackground: 'off', visionLift: false, version: 2 }),
    );
    expect(v).toMatchObject({ visionClear: 80, visionBlur: 12, visionDim: 35, visionBackground: 'off', visionLift: false });
    const bad = parseAppearance(JSON.stringify({ visionClear: 83, visionBlur: 400, visionDim: -5, version: 2 }));
    expect(bad).toMatchObject({ visionClear: 50, visionBlur: 26, visionDim: 50 });
  });

  it('falls back on anything unknown or corrupt', () => {
    expect(parseAppearance('{"slip":"cards","version":2}').slip).toBe('list');
    expect(parseAppearance('not json')).toEqual(DEFAULT_APPEARANCE);
  });
});

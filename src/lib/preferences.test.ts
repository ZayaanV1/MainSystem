import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { normalise, TODAY_SECTIONS } from './preferences';

describe('normalise', () => {
  it('is the default order with nothing hidden when nothing is saved', () => {
    expect(normalise({})).toEqual({ order: [...TODAY_SECTIONS], hidden: [], modulesOff: [] });
  });

  it('keeps a saved order and drops names it does not know', () => {
    const order = ['checklist', 'capture', 'gremlins'];
    // The board is missing from this saved order, so it takes its default
    // place at the top rather than being dropped.
    expect(normalise({ order }).order).toEqual(['board', 'checklist', 'capture']);
  });

  it('drops the sections that moved to Schedule from an order saved before', () => {
    // Saved before 19 Oct 2026, when the work, what is ahead, the briefing,
    // the next class and the inbox were all on Today.
    const order = ['capture', 'checklist', 'ribbon', 'briefing', 'work', 'ahead', 'inbox', 'board'];
    expect(normalise({ order }).order).toEqual(['capture', 'checklist', 'board']);
    expect(normalise({ hidden: ['inbox', 'checklist'] }).hidden).toEqual(['checklist']);
  });

  it('never hides the board or capture', () => {
    expect(normalise({ hidden: ['capture', 'board', 'checklist'] }).hidden).toEqual(['checklist']);
  });

  it('keeps only known modules, once each', () => {
    expect(normalise({ modulesOff: ['abood', 'abood', 'diet'] }).modulesOff).toEqual(['abood']);
  });
});

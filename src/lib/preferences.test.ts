import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { normalise, TODAY_SECTIONS } from './preferences';

describe('normalise', () => {
  it('is the default order with nothing hidden when nothing is saved', () => {
    expect(normalise({})).toEqual({ order: [...TODAY_SECTIONS], hidden: [], modulesOff: [] });
  });

  it('keeps a saved order and drops names it does not know', () => {
    const order = ['work', 'capture', 'inbox', 'checklist', 'ribbon', 'briefing', 'ahead', 'gremlins'];
    expect(normalise({ order }).order).toEqual(['work', 'capture', 'inbox', 'checklist', 'ribbon', 'briefing', 'ahead']);
  });

  it('puts a section the saved order lacks back in its default place', () => {
    // Saved before "ahead" existed: it returns after "work", where it belongs.
    const order = ['capture', 'checklist', 'ribbon', 'briefing', 'work', 'inbox'];
    expect(normalise({ order }).order).toEqual([...TODAY_SECTIONS]);
  });

  it('never hides capture or the work', () => {
    expect(normalise({ hidden: ['capture', 'work', 'inbox'] }).hidden).toEqual(['inbox']);
  });

  it('keeps only known modules, once each', () => {
    expect(normalise({ modulesOff: ['abood', 'abood', 'diet'] }).modulesOff).toEqual(['abood']);
  });
});

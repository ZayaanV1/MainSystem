import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
const { snippet } = await import('./search');

describe('snippet', () => {
  it('shows the words around the match, on one line', () => {
    const text = 'Labs run weekly.\nOffice hours are Tuesday 2 to 4 p.m. in EV 3.301, and by appointment the rest of the week.';
    expect(snippet(text, 'tuesday', 12)).toBe('…e hours are Tuesday 2 to 4 p.m.…');
  });

  it('keeps the start when the match is near it, and the end when near that', () => {
    expect(snippet('Tuesday 2-4', 'tues')).toBe('Tuesday 2-4');
  });
});

import { describe, expect, it } from 'vitest';
import { rank, type Command } from './CommandPalette';

const c = (id: string, group: Command['group'], label: string, extra: Partial<Command> = {}): Command => ({ id, group, label, run: () => {}, ...extra });

const all: Command[] = [
  c('do-capture', 'Do', 'Capture a thought', { keywords: 'add inbox' }),
  c('go-today', 'Go to', 'Today'),
  c('go-week', 'Go to', 'Week'),
  c('w1', 'Work', 'Problem set 4: interference', { hint: 'PHYS 205 · Mon' }),
  c('w2', 'Work', 'Physics lab report', { hint: 'PHYS 205 · Thu' }),
  c('c1', 'Courses', 'PHYS 205', { keywords: 'Waves and Optics' }),
  c('s1', 'Settings', 'Appearance', { keywords: 'theme dark light' }),
];

describe('rank', () => {
  it('shows actions and screens before anything is typed', () => {
    expect(rank(all, '').map((x) => x.id)).toEqual(['do-capture', 'go-today', 'go-week']);
  });

  it('puts a label that starts with the query first, and keeps each group together', () => {
    const ids = rank(all, 'phys').map((x) => x.id);
    expect(ids[0]).toBe('w2');
    expect(ids).toEqual(['w2', 'w1', 'c1']);
  });

  it('finds things by their keywords', () => {
    expect(rank(all, 'dark').map((x) => x.id)).toEqual(['s1']);
    expect(rank(all, 'inbox').map((x) => x.id)).toEqual(['do-capture']);
  });

  it('finds nothing rather than everything for a miss', () => {
    expect(rank(all, 'zzz')).toEqual([]);
  });
});

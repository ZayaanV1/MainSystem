import { describe, it, expect } from 'vitest';
import {
  durationLabel,
  freeGaps,
  hourRange,
  minuteOfDay,
  placeSpans,
  progressThrough,
  readTitle,
} from './blocks';

describe('readTitle', () => {
  // Real titles from a Concordia timetable export, Fall 2026.
  it('leads a timetable title with the course and the kind of meeting', () => {
    expect(readTitle('MB S2.210 - COEN 231-U - LEC')).toEqual({
      headline: 'COEN 231 Lecture',
      section: 'Section U',
      room: 'MB S2.210',
      type: 'Lecture',
      code: 'COEN 231',
    });
  });

  it('keeps a sub-section and reads tutorials', () => {
    const r = readTitle('MB S2.455 - COEN 212-F FD - TUT');
    expect(r.headline).toBe('COEN 212 Tutorial');
    expect(r.section).toBe('Section F FD');
  });

  it('says nothing about a room that is not decided, and names remote as remote', () => {
    expect(readTitle('TBA - COEN 212-FO-X - LAB').room).toBeNull();
    expect(readTitle('TBA - COEN 212-FO-X - LAB')).toMatchObject({
      headline: 'COEN 212 Lab',
      section: 'Section FO-X',
    });
    expect(readTitle('REMOTE - MATH 205-RMT2 - TUT').room).toBe('Remote');
  });

  it('reads a room with no space in it', () => {
    expect(readTitle('H435 - MATH 205-J - LEC')).toMatchObject({ room: 'H435', headline: 'MATH 205 Lecture' });
  });

  it('leaves anything the person wrote exactly as written', () => {
    for (const t of ['🚌 Travel', '📖 PHYS 205 Study', 'PHYS 205 - Quiz 3 available', 'Lecture - notes - LEC stuff']) {
      expect(readTitle(t)).toEqual({ headline: t, section: null, room: null, type: null, code: null });
    }
  });
});

describe('durationLabel', () => {
  it('is compact', () => {
    expect(durationLabel(50)).toBe('50 min');
    expect(durationLabel(60)).toBe('1 h');
    expect(durationLabel(75)).toBe('1 h 15');
    expect(durationLabel(165)).toBe('2 h 45');
    expect(durationLabel(65)).toBe('1 h 05');
  });
});

describe('minuteOfDay', () => {
  it('is local, not UTC', () => {
    // 13:15 UTC is 09:15 in Toronto in September.
    expect(minuteOfDay(new Date('2026-09-23T13:15:00Z'), 'America/Toronto')).toBe(9 * 60 + 15);
    expect(minuteOfDay(new Date('2026-09-23T13:15:00Z'), 'Australia/Sydney')).toBe(23 * 60 + 15);
  });
});

describe('placeSpans', () => {
  it('gives a lone event the full width', () => {
    expect(placeSpans([{ id: 'a', start: 60, end: 120 }])).toEqual([
      { id: 'a', start: 60, end: 120, lane: 0, lanes: 1 },
    ]);
  });

  it('puts two overlapping events side by side, so neither disappears', () => {
    const p = placeSpans([
      { id: 'a', start: 60, end: 180 },
      { id: 'b', start: 120, end: 240 },
    ]);
    const byId = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(byId.a).toMatchObject({ lane: 0, lanes: 2 });
    expect(byId.b).toMatchObject({ lane: 1, lanes: 2 });
  });

  it('reuses a column once it frees up, within one cluster', () => {
    // a runs long; b and c are back to back beside it and share one column.
    const p = placeSpans([
      { id: 'a', start: 0, end: 300 },
      { id: 'b', start: 60, end: 120 },
      { id: 'c', start: 120, end: 200 },
    ]);
    const byId = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(byId.b.lane).toBe(1);
    expect(byId.c.lane).toBe(1);
    expect(p.every((x) => x.lanes === 2)).toBe(true);
  });

  it('does not let a morning clash narrow the afternoon', () => {
    const p = placeSpans([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 540, end: 600 },
      { id: 'c', start: 960, end: 1020 },
    ]);
    expect(p.find((x) => x.id === 'c')).toMatchObject({ lane: 0, lanes: 1 });
  });

  it('treats back-to-back as not overlapping', () => {
    const p = placeSpans([
      { id: 'a', start: 60, end: 120 },
      { id: 'b', start: 120, end: 180 },
    ]);
    expect(p.every((x) => x.lanes === 1 && x.lane === 0)).toBe(true);
  });
});

describe('hourRange', () => {
  it('fits the day from the hour before the first thing to the hour after the last', () => {
    expect(hourRange([8 * 60 + 15, 21 * 60])).toEqual([8, 21]);
    expect(hourRange([8 * 60 + 15, 21 * 60 + 1])).toEqual([8, 22]);
  });

  it('never draws less than the minimum span', () => {
    const [a, b] = hourRange([14 * 60, 14 * 60 + 30]);
    expect(b - a).toBeGreaterThanOrEqual(4);
    expect(a).toBeLessThanOrEqual(14);
    expect(b).toBeGreaterThanOrEqual(15);
  });

  it('stays inside the day at both ends', () => {
    expect(hourRange([23 * 60 + 30, 23 * 60 + 59])[1]).toBe(24);
    expect(hourRange([10, 20])[0]).toBe(0);
  });

  it('has a sensible default for an empty day', () => {
    expect(hourRange([])).toEqual([9, 17]);
  });
});

describe('freeGaps', () => {
  it('reports the time between things, not across them', () => {
    const gaps = freeGaps([
      { id: 'lec', start: 525, end: 600 },
      { id: 'tut', start: 700, end: 750 },
    ]);
    expect(gaps).toEqual([{ after: 'lec', minutes: 100 }]);
  });

  it('does not call the rest of a long block free because a short one ended inside it', () => {
    const gaps = freeGaps([
      { id: 'lab', start: 600, end: 780 },
      { id: 'call', start: 620, end: 640 },
      { id: 'next', start: 800, end: 860 },
    ]);
    expect(gaps).toEqual([{ after: 'lab', minutes: 20 }]);
  });

  it('ignores gaps too short to use', () => {
    expect(freeGaps([{ id: 'a', start: 0, end: 60 }, { id: 'b', start: 70, end: 90 }])).toEqual([]);
  });
});

describe('progressThrough', () => {
  const start = new Date('2026-09-23T13:00:00Z');
  const end = new Date('2026-09-23T14:00:00Z');
  it('is a fraction while under way', () => {
    expect(progressThrough(start, end, new Date('2026-09-23T13:15:00Z'))).toBe(0.25);
  });
  it('is null before, after, and for an instant', () => {
    expect(progressThrough(start, end, new Date('2026-09-23T12:59:00Z'))).toBeNull();
    expect(progressThrough(start, end, end)).toBeNull();
    expect(progressThrough(start, null, new Date('2026-09-23T13:15:00Z'))).toBeNull();
  });
});

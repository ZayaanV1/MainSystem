import { describe, it, expect } from 'vitest';
import { parseIcs, unfold } from '../../supabase/functions/_shared/icsparse';

/**
 * RFC 5545 fails SILENTLY in both directions.
 *
 * The writer's tests exist because a malformed line makes a client accept the
 * feed and quietly drop events. The reader has the mirror-image risk: a feed
 * that parses to fewer events than it contains looks exactly like a feed with
 * fewer events in it. So most of these assert that nothing is lost, and that
 * anything unreadable is REPORTED rather than skipped in silence.
 */

const ics = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', body, 'END:VCALENDAR'].join('\r\n');

const event = (lines: string[]) => ics(['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n'));

describe('unfold', () => {
  it('rejoins a folded line before anything else reads it', () => {
    // The single most common reason a hand-rolled reader drops half a feed: a
    // folded DTSTART is not a DTSTART to a naive parser.
    const out = unfold('DTSTART;TZID=America/Tor\r\n onto:20260908T113000');
    expect(out[0]).toBe('DTSTART;TZID=America/Toronto:20260908T113000');
  });

  it('treats a tab continuation the same as a space', () => {
    expect(unfold('SUMMARY:Very long ti\r\n\ttle')[0]).toBe('SUMMARY:Very long title');
  });

  it('leaves ordinary lines alone', () => {
    expect(unfold('A:1\r\nB:2')).toEqual(['A:1', 'B:2']);
  });
});

describe('parseIcs — a single event', () => {
  it('reads title, day and time', () => {
    const { events } = parseIcs(
      event(['SUMMARY:COEN 311 Lecture', 'DTSTART:20260908T113000', 'DTEND:20260908T125000']),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      summary: 'COEN 311 Lecture',
      day: '2026-09-08',
      time: '11:30',
      endTime: '12:50',
      repeats: false,
    });
  });

  it('reads an all-day entry as having no time', () => {
    const { events } = parseIcs(event(['SUMMARY:Reading week', 'DTSTART;VALUE=DATE:20261019']));
    expect(events[0].time).toBeNull();
    expect(events[0].day).toBe('2026-10-19');
  });

  it('converts a UTC stamp into the reader zone', () => {
    // 15:30Z is 11:30 in Toronto, which is UTC-4 in September.
    const { events } = parseIcs(event(['SUMMARY:Lab', 'DTSTART:20260908T153000Z']), -240);
    expect(events[0]).toMatchObject({ day: '2026-09-08', time: '11:30' });
  });

  it('un-escapes text rather than showing the escapes', () => {
    const { events } = parseIcs(
      event(['SUMMARY:Essay\\, part 2', 'LOCATION:H\\; 920', 'DTSTART:20260908T090000']),
    );
    expect(events[0].summary).toBe('Essay, part 2');
    expect(events[0].location).toBe('H; 920');
  });
});

describe('parseIcs — weekly recurrence, which is what a timetable is', () => {
  it('expands a weekly rule with a count', () => {
    const { events } = parseIcs(
      event(['SUMMARY:Lecture', 'DTSTART:20260908T113000', 'RRULE:FREQ=WEEKLY;COUNT=3']),
    );
    expect(events[0].days).toEqual(['2026-09-08', '2026-09-15', '2026-09-22']);
    expect(events[0].repeats).toBe(true);
  });

  it('expands a rule bounded by UNTIL', () => {
    const { events } = parseIcs(
      event([
        'SUMMARY:Lecture',
        'DTSTART:20260908T113000',
        'RRULE:FREQ=WEEKLY;UNTIL=20260929T000000Z',
      ]),
    );
    expect(events[0].days).toEqual(['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
  });

  it('handles two days a week', () => {
    // 8 Sep 2026 is a Tuesday.
    const { events } = parseIcs(
      event(['SUMMARY:Tut', 'DTSTART:20260908T113000', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4']),
    );
    expect(events[0].days).toEqual(['2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17']);
  });

  it('honours INTERVAL for a biweekly lab', () => {
    const { events } = parseIcs(
      event(['SUMMARY:Lab', 'DTSTART:20260908T113000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3']),
    );
    expect(events[0].days).toEqual(['2026-09-08', '2026-09-22', '2026-10-06']);
  });

  it('never generates before the first occurrence', () => {
    const { events } = parseIcs(
      event(['SUMMARY:Lecture', 'DTSTART:20260910T113000', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=3']),
    );
    expect(events[0].days.every((d) => d >= '2026-09-10')).toBe(true);
  });

  it('bounds an unbounded rule instead of running forever', () => {
    // FREQ=WEEKLY with no COUNT and no UNTIL is legal and means forever.
    // Forever is not importable.
    const { events } = parseIcs(
      event(['SUMMARY:Forever', 'DTSTART:20260908T113000', 'RRULE:FREQ=WEEKLY']),
    );
    expect(events[0].days.length).toBeLessThanOrEqual(60);
    expect(events[0].days.length).toBeGreaterThan(0);
  });
});

describe('parseIcs — what it refuses to guess', () => {
  it('imports a monthly rule ONCE and says why', () => {
    // A rule this cannot read makes its event a single occurrence with a
    // stated reason, never a wrong series.
    const { events, skipped } = parseIcs(
      event(['SUMMARY:Fee deadline', 'DTSTART:20260908T113000', 'RRULE:FREQ=MONTHLY;COUNT=4']),
    );
    expect(events[0].days).toEqual(['2026-09-08']);
    expect(skipped.join(' ')).toContain('cannot read');
    expect(skipped.join(' ')).toContain('Fee deadline');
  });

  it('reports an event with no start rather than dropping it silently', () => {
    const { events, skipped } = parseIcs(event(['SUMMARY:Mystery']));
    expect(events).toHaveLength(0);
    expect(skipped.join(' ')).toContain('Mystery');
  });

  it('reports an untitled event', () => {
    const { events, skipped } = parseIcs(event(['DTSTART:20260908T113000']));
    expect(events).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it('reports a start date it cannot parse', () => {
    const { skipped } = parseIcs(event(['SUMMARY:Broken', 'DTSTART:not-a-date']));
    expect(skipped.join(' ')).toContain('Broken');
  });

  it('reads the good events out of a feed that also contains bad ones', () => {
    // The important property: one unreadable entry must not cost the rest.
    const feed = ics(
      [
        'BEGIN:VEVENT\r\nSUMMARY:Good\r\nDTSTART:20260908T090000\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nSUMMARY:Bad\r\nEND:VEVENT',
        'BEGIN:VEVENT\r\nSUMMARY:Also good\r\nDTSTART:20260909T090000\r\nEND:VEVENT',
      ].join('\r\n'),
    );
    const { events, skipped } = parseIcs(feed);
    expect(events.map((e) => e.summary)).toEqual(['Good', 'Also good']);
    expect(skipped).toHaveLength(1);
  });

  it('ignores everything outside a VEVENT', () => {
    const { events } = parseIcs(
      ics('BEGIN:VTIMEZONE\r\nSUMMARY:Not an event\r\nEND:VTIMEZONE'),
    );
    expect(events).toHaveLength(0);
  });

  it('survives an empty feed without throwing', () => {
    expect(parseIcs('')).toEqual({ events: [], skipped: [] });
    expect(parseIcs(ics(''))).toEqual({ events: [], skipped: [] });
  });
});

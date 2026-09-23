import { describe, it, expect } from 'vitest';
import { parseFeed, type FeedWindow } from '../../supabase/functions/_shared/feed';

/**
 * The live-feed reader.
 *
 * Most of these exist because the timetable parser gets them wrong in a way
 * that is harmless for a one-time paste and dangerous for a mirror that
 * refreshes itself with nobody watching: a weekly series from two years ago
 * that yields nothing now, times an hour out after the clock change, a
 * cancelled meeting that still shows.
 */

const TORONTO: FeedWindow = { zone: 'America/Toronto', from: '2026-09-01', to: '2026-12-31' };

function cal(...events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Zayaan',
    'X-WR-TIMEZONE:America/Toronto',
    // A VTIMEZONE block has DTSTART lines of its own. They must not be read
    // as an event's.
    'BEGIN:VTIMEZONE',
    'TZID:America/Toronto',
    'BEGIN:STANDARD',
    'DTSTART:19701101T020000',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

function ev(...lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

/** Local wall-clock time of an instant in Toronto, as 'YYYY-MM-DD HH:MM'. */
function toronto(iso: string): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => f.find((p) => p.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

describe('the calendar itself', () => {
  it('reads its name', () => {
    expect(parseFeed(cal(), TORONTO).name).toBe('Zayaan');
  });

  it('ignores DTSTART lines that belong to a timezone definition', () => {
    expect(parseFeed(cal(), TORONTO).instances).toEqual([]);
  });
});

describe('single events', () => {
  it('converts a UTC stamp to the right local time', () => {
    const r = parseFeed(
      cal(ev('UID:a', 'SUMMARY:Seminar', 'DTSTART:20260915T140000Z', 'DTEND:20260915T150000Z')),
      TORONTO,
    );
    expect(r.instances).toHaveLength(1);
    // 14:00Z in September is 10:00 in Toronto, daylight time.
    expect(toronto(r.instances[0].startsAt)).toBe('2026-09-15 10:00');
    expect(toronto(r.instances[0].endsAt!)).toBe('2026-09-15 11:00');
  });

  it('reads a TZID wall-clock time in that zone, not the reader\'s', () => {
    const r = parseFeed(
      cal(ev('UID:b', 'SUMMARY:Call with London', 'DTSTART;TZID=Europe/London:20260915T150000')),
      TORONTO,
    );
    // 15:00 in London is 10:00 in Toronto.
    expect(toronto(r.instances[0].startsAt)).toBe('2026-09-15 10:00');
  });

  it('accepts a quoted TZID, which may contain a colon', () => {
    const r = parseFeed(
      cal(ev('UID:q', 'SUMMARY:Quoted', 'DTSTART;TZID="America/Toronto":20260915T090000')),
      TORONTO,
    );
    expect(toronto(r.instances[0].startsAt)).toBe('2026-09-15 09:00');
  });

  it('understands the Windows zone names Outlook publishes', () => {
    const r = parseFeed(
      cal(ev('UID:w', 'SUMMARY:Outlook', 'DTSTART;TZID=Eastern Standard Time:20260915T090000')),
      TORONTO,
    );
    expect(toronto(r.instances[0].startsAt)).toBe('2026-09-15 09:00');
    expect(r.problems).toEqual([]);
  });

  it('falls back to the reader\'s zone for an unknown TZID, and says so', () => {
    const r = parseFeed(
      cal(ev('UID:u', 'SUMMARY:Odd', 'DTSTART;TZID=Somewhere Imaginary:20260915T090000')),
      TORONTO,
    );
    expect(toronto(r.instances[0].startsAt)).toBe('2026-09-15 09:00');
    expect(r.problems.join(' ')).toMatch(/Somewhere Imaginary/);
  });

  it('stores an all-day event at the start of the reader\'s day', () => {
    const r = parseFeed(
      cal(ev('UID:c', 'SUMMARY:Reading week', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261017')),
      TORONTO,
    );
    const [i] = r.instances;
    expect(i.allDay).toBe(true);
    expect(toronto(i.startsAt)).toBe('2026-10-12 00:00');
    // DTEND is exclusive: five days, ending at the start of the 17th.
    expect(toronto(i.endsAt!)).toBe('2026-10-17 00:00');
  });

  it('leaves a single-day all-day event without an end, like a hand-added one', () => {
    const r = parseFeed(
      cal(ev('UID:d', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261013')),
      TORONTO,
    );
    expect(r.instances[0].endsAt).toBeNull();
  });

  it('uses the event\'s own title, not an alarm\'s', () => {
    // VALARM blocks can carry a SUMMARY for email reminders. It sits inside
    // the VEVENT and must not replace the event's name.
    const r = parseFeed(
      cal(
        ev(
          'UID:e',
          'SUMMARY:Lab',
          'DTSTART:20260915T140000Z',
          'BEGIN:VALARM',
          'ACTION:EMAIL',
          'SUMMARY:Reminder email',
          'TRIGGER:-PT15M',
          'END:VALARM',
        ),
      ),
      TORONTO,
    );
    expect(r.instances[0].title).toBe('Lab');
  });

  it('unescapes text', () => {
    const r = parseFeed(
      cal(ev('UID:f', 'SUMMARY:Stats\\, week 3', 'LOCATION:Room 2\\; east wing', 'DTSTART:20260915T140000Z')),
      TORONTO,
    );
    expect(r.instances[0].title).toBe('Stats, week 3');
    expect(r.instances[0].location).toBe('Room 2; east wing');
  });

  it('drops a cancelled event entirely', () => {
    const r = parseFeed(
      cal(ev('UID:g', 'SUMMARY:Cancelled', 'STATUS:CANCELLED', 'DTSTART:20260915T140000Z')),
      TORONTO,
    );
    expect(r.instances).toEqual([]);
  });
});

describe('the window', () => {
  it('leaves out events outside it', () => {
    const r = parseFeed(
      cal(
        ev('UID:old', 'SUMMARY:Last year', 'DTSTART:20250915T140000Z'),
        ev('UID:far', 'SUMMARY:Next year', 'DTSTART:20270915T140000Z'),
      ),
      TORONTO,
    );
    expect(r.instances).toEqual([]);
  });

  it('keeps an event that began before the window and runs into it', () => {
    const r = parseFeed(
      cal(ev('UID:span', 'SUMMARY:Conference', 'DTSTART;VALUE=DATE:20260830', 'DTEND;VALUE=DATE:20260903')),
      TORONTO,
    );
    expect(r.instances).toHaveLength(1);
  });
});

describe('repeats', () => {
  it('finds this term\'s occurrences of a series that started years ago', () => {
    // THE bug this file exists for. The timetable parser expands forward from
    // the first occurrence and stops after sixty, so a weekly meeting that
    // began in 2024 produced 2024 dates and nothing now.
    const r = parseFeed(
      cal(
        ev(
          'UID:weekly',
          'SUMMARY:Supervisor meeting',
          'DTSTART;TZID=America/Toronto:20240108T100000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO',
        ),
      ),
      TORONTO,
    );
    expect(r.instances.length).toBeGreaterThan(15);
    expect(toronto(r.instances[0].startsAt)).toBe('2026-09-07 10:00');
  });

  it('keeps a 09:00 meeting at 09:00 across the November clock change', () => {
    const r = parseFeed(
      cal(
        ev(
          'UID:dst',
          'SUMMARY:Standup',
          'DTSTART;TZID=America/Toronto:20261026T090000',
          'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3',
        ),
      ),
      TORONTO,
    );
    const local = r.instances.map((i) => toronto(i.startsAt));
    expect(local).toEqual(['2026-10-26 09:00', '2026-11-02 09:00', '2026-11-09 09:00']);
    // And the UTC instants really did move, which is how you know the local
    // time was held rather than the instant.
    expect(r.instances[0].startsAt).toBe('2026-10-26T13:00:00.000Z');
    expect(r.instances[1].startsAt).toBe('2026-11-02T14:00:00.000Z');
  });

  it('counts COUNT from the first occurrence, even one before the window', () => {
    const r = parseFeed(
      cal(
        ev(
          'UID:count',
          'SUMMARY:Ten sessions',
          'DTSTART;TZID=America/Toronto:20260824T100000',
          'RRULE:FREQ=WEEKLY;COUNT=4',
        ),
      ),
      TORONTO,
    );
    // Aug 24 and 31 are before the window; Sep 7 and 14 are the last two.
    expect(r.instances.map((i) => toronto(i.startsAt))).toEqual([
      '2026-09-07 10:00',
      '2026-09-14 10:00',
    ]);
  });

  it('stops at UNTIL', () => {
    const r = parseFeed(
      cal(
        ev(
          'UID:until',
          'SUMMARY:Short run',
          'DTSTART;TZID=America/Toronto:20260901T100000',
          'RRULE:FREQ=DAILY;UNTIL=20260903T140000Z',
        ),
      ),
      TORONTO,
    );
    expect(r.instances).toHaveLength(3);
  });

  it('removes an occurrence named by EXDATE, even when written in UTC', () => {
    const r = parseFeed(
      cal(
        ev(
          'UID:ex',
          'SUMMARY:Tutorial',
          'DTSTART;TZID=America/Toronto:20260908T140000',
          'RRULE:FREQ=WEEKLY;COUNT=3',
          // 14:00 Toronto on Sep 15 is 18:00Z.
          'EXDATE:20260915T180000Z',
        ),
      ),
      TORONTO,
    );
    expect(r.instances.map((i) => toronto(i.startsAt))).toEqual([
      '2026-09-08 14:00',
      '2026-09-22 14:00',
    ]);
  });

  it('shows a moved occurrence once, at its new time', () => {
    // Without handling RECURRENCE-ID, the original slot is generated by the
    // rule AND the moved copy is emitted as its own event: the meeting
    // appears twice, once at a time it is no longer happening.
    const r = parseFeed(
      cal(
        ev(
          'UID:mv',
          'SUMMARY:Office hours',
          'DTSTART;TZID=America/Toronto:20260908T140000',
          'RRULE:FREQ=WEEKLY;COUNT=3',
        ),
        ev(
          'UID:mv',
          'SUMMARY:Office hours (moved)',
          'RECURRENCE-ID;TZID=America/Toronto:20260915T140000',
          'DTSTART;TZID=America/Toronto:20260916T160000',
        ),
      ),
      TORONTO,
    );
    expect(r.instances.map((i) => `${toronto(i.startsAt)} ${i.title}`)).toEqual([
      '2026-09-08 14:00 Office hours',
      '2026-09-16 16:00 Office hours (moved)',
      '2026-09-22 14:00 Office hours',
    ]);
  });

  it('drops a single cancelled occurrence of a series', () => {
    const r = parseFeed(
      cal(
        ev(
          'UID:cx',
          'SUMMARY:Lecture',
          'DTSTART;TZID=America/Toronto:20260908T090000',
          'RRULE:FREQ=WEEKLY;COUNT=3',
        ),
        ev(
          'UID:cx',
          'SUMMARY:Lecture',
          'STATUS:CANCELLED',
          'RECURRENCE-ID;TZID=America/Toronto:20260915T090000',
          'DTSTART;TZID=America/Toronto:20260915T090000',
        ),
      ),
      TORONTO,
    );
    expect(r.instances.map((i) => toronto(i.startsAt))).toEqual([
      '2026-09-08 09:00',
      '2026-09-22 09:00',
    ]);
  });

  it('aligns every-other-week to the week, not to the first day', () => {
    // Starts on a Wednesday, repeats Monday and Wednesday every second week.
    // The week containing the start begins Monday Aug 31, so the Monday of
    // that week is before the start and skipped, and the next pair is Sep 14.
    const r = parseFeed(
      cal(
        ev(
          'UID:alt',
          'SUMMARY:Lab',
          'DTSTART;TZID=America/Toronto:20260902T130000',
          'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5',
        ),
      ),
      TORONTO,
    );
    expect(r.instances.map((i) => i.startsAt.slice(0, 10))).toEqual([
      '2026-09-02',
      '2026-09-14',
      '2026-09-16',
      '2026-09-28',
      '2026-09-30',
    ]);
  });

  it('reads "the second Tuesday of every month"', () => {
    const r = parseFeed(
      cal(
        ev(
          'UID:2tu',
          'SUMMARY:Society',
          'DTSTART;TZID=America/Toronto:20260908T190000',
          'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=4',
        ),
      ),
      TORONTO,
    );
    expect(r.instances.map((i) => toronto(i.startsAt).slice(0, 10))).toEqual([
      '2026-09-08',
      '2026-10-13',
      '2026-11-10',
      '2026-12-08',
    ]);
  });

  it('reads "the last Friday of every month"', () => {
    const r = parseFeed(
      cal(
        ev(
          'UID:-1fr',
          'SUMMARY:Payday',
          'DTSTART;VALUE=DATE:20260925',
          'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3',
        ),
      ),
      TORONTO,
    );
    expect(r.instances.map((i) => toronto(i.startsAt).slice(0, 10))).toEqual([
      '2026-09-25',
      '2026-10-30',
      '2026-11-27',
    ]);
  });

  it('skips months that have no 31st rather than moving to the 30th', () => {
    const r = parseFeed(
      cal(
        ev(
          'UID:31',
          'SUMMARY:Month end',
          'DTSTART;VALUE=DATE:20260831',
          'RRULE:FREQ=MONTHLY;COUNT=4',
        ),
      ),
      { ...TORONTO, from: '2026-08-01', to: '2027-03-31' },
    );
    expect(r.instances.map((i) => toronto(i.startsAt).slice(0, 10))).toEqual([
      '2026-08-31',
      '2026-10-31',
      '2026-12-31',
      '2027-01-31',
    ]);
  });

  it('skips February 29th in years that do not have one', () => {
    const r = parseFeed(
      cal(
        ev('UID:leap', 'SUMMARY:Leap birthday', 'DTSTART;VALUE=DATE:20240229', 'RRULE:FREQ=YEARLY'),
      ),
      { zone: 'America/Toronto', from: '2025-01-01', to: '2028-12-31' },
    );
    expect(r.instances.map((i) => toronto(i.startsAt).slice(0, 10))).toEqual(['2028-02-29']);
  });

  it('leaves out a pattern it cannot read, and names it, rather than guessing', () => {
    // "The last weekday of the month" as Outlook writes it. A partial reading
    // would produce a plausible-looking set of wrong dates.
    const r = parseFeed(
      cal(
        ev(
          'UID:setpos',
          'SUMMARY:Timesheet',
          'DTSTART;TZID=America/Toronto:20260930T170000',
          'RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
        ),
      ),
      TORONTO,
    );
    expect(r.instances).toEqual([]);
    expect(r.problems.join(' ')).toMatch(/Timesheet.*BYSETPOS/);
  });

  it('reads a series that began long ago quickly, and exactly', () => {
    // A daily series since 2010 has ~6,000 occurrences before this window.
    // Each still counts toward COUNT, but converting each to an instant went
    // through Intl twice — and Google feeds are re-read in full every sync,
    // inside an edge function with a CPU ceiling.
    const t0 = performance.now();
    const r = parseFeed(
      cal(
        ev(
          'UID:daily-2010',
          'SUMMARY:Journal',
          'DTSTART;TZID=America/Toronto:20100101T210000',
          'RRULE:FREQ=DAILY',
        ),
      ),
      TORONTO,
    );
    const elapsed = performance.now() - t0;

    // Sep 1 to Dec 31 inclusive.
    expect(r.instances).toHaveLength(122);
    expect(toronto(r.instances[0].startsAt)).toBe('2026-09-01 21:00');
    expect(toronto(r.instances[121].startsAt)).toBe('2026-12-31 21:00');
    expect(elapsed).toBeLessThan(400);
  });

  it('gives each occurrence the series UID, so a sync can diff them', () => {
    const r = parseFeed(
      cal(
        ev(
          'UID:same',
          'SUMMARY:Gym',
          'DTSTART;TZID=America/Toronto:20260901T070000',
          'RRULE:FREQ=DAILY;COUNT=3',
        ),
      ),
      TORONTO,
    );
    expect(new Set(r.instances.map((i) => i.uid))).toEqual(new Set(['same']));
    expect(new Set(r.instances.map((i) => i.startsAt)).size).toBe(3);
  });
});

import { describe, it, expect } from 'vitest';
import {
  botChallengeReason,
  checkFeedUrl,
  isBotChallenge,
  isPrivateAddress,
} from '../../supabase/functions/_shared/feedurl';
import {
  courseCodeOf,
  diffMirror,
  duplicatesTracked,
  fingerprintInstances,
  kindOf,
  mirrorInsertRows,
  normaliseCode,
  type MirrorInstance,
  type MirrorRow,
} from '../../supabase/functions/_shared/feedsync';

const GOOGLE_SECRET =
  'https://calendar.google.com/calendar/ical/someone%40gmail.com/private-0123456789abcdef/basic.ics';

describe('checkFeedUrl', () => {
  it('accepts a Google secret address', () => {
    expect(checkFeedUrl(GOOGLE_SECRET)).toEqual({ ok: true, url: GOOGLE_SECRET });
  });

  it('turns webcal:// into https://', () => {
    const r = checkFeedUrl('webcal://p01-calendars.icloud.com/published/2/abc');
    expect(r).toEqual({ ok: true, url: 'https://p01-calendars.icloud.com/published/2/abc' });
  });

  it('refuses http, because a secret address would travel in clear text', () => {
    const r = checkFeedUrl('http://example.com/cal.ics');
    expect(r.ok).toBe(false);
  });

  it('names the right Google setting when the wrong link is pasted', () => {
    // The browser-bar link and the "public URL" both return a web page.
    const r = checkFeedUrl('https://calendar.google.com/calendar/u/0/r');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Secret address in iCal format/);
  });

  // The server fetches this address, so everything below is the forgery case.
  it.each([
    ['https://localhost/cal.ics'],
    ['https://127.0.0.1/cal.ics'],
    ['https://169.254.169.254/latest/meta-data'],
    ['https://[::1]/cal.ics'],
    ['https://metadata.google.internal/computeMetadata/v1'],
    ['https://printer.local/cal.ics'],
    ['https://intranet/cal.ics'],
    ['https://example.com:8080/cal.ics'],
    ['https://user:pass@example.com/cal.ics'],
    ['ftp://example.com/cal.ics'],
    ['file:///etc/passwd'],
  ])('refuses %s', (url) => {
    expect(checkFeedUrl(url).ok).toBe(false);
  });

  it('refuses nothing at all, with a sentence rather than an error', () => {
    const r = checkFeedUrl('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(5);
  });
});

const MOODLE_EXPORT =
  'https://moodle.concordia.ca/moodle/calendar/export_execute.php?userid=1&authtoken=abc&preset_what=all&preset_time=recentupcoming';

describe('Moodle addresses', () => {
  it('accepts the export feed', () => {
    expect(checkFeedUrl(MOODLE_EXPORT).ok).toBe(true);
  });

  it('names the setting to copy when given a Moodle page instead', () => {
    for (const page of [
      'https://moodle.concordia.ca/moodle/course/view.php?id=123',
      'https://moodle.concordia.ca/moodle/calendar/view.php?view=month',
      'https://moodle.example.edu/my/',
      'https://lms.example.edu/moodle/calendar/export.php',
    ]) {
      const r = checkFeedUrl(page);
      expect(r.ok, page).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/Export calendar/);
    }
  });

  it('leaves other hosts alone', () => {
    expect(checkFeedUrl('https://outlook.office365.com/owa/calendar/x/y/calendar.ics').ok).toBe(true);
  });
});

describe('isBotChallenge', () => {
  // The headers Concordia's firewall actually returned, 23 Sep 2026, with a
  // 202 and an empty body. 202 is a success status, which is the whole trap.
  it('recognises an AWS WAF challenge', () => {
    const h = new Headers({
      server: 'awselb/2.0',
      'content-length': '0',
      'x-amzn-waf-action': 'challenge',
      'content-type': 'text/html; charset=UTF-8',
    });
    expect(isBotChallenge(h)).toBe(true);
  });

  it('recognises a Cloudflare challenge', () => {
    expect(isBotChallenge(new Headers({ 'cf-mitigated': 'challenge' }))).toBe(true);
  });

  it('does not mistake an ordinary response for one', () => {
    expect(isBotChallenge(new Headers({ 'content-type': 'text/calendar' }))).toBe(false);
  });

  it('points a Moodle feed at the route that works, and says why', () => {
    expect(botChallengeReason(MOODLE_EXPORT)).toMatch(/Moodle.*only lets web browsers.*Google Calendar/s);
    expect(botChallengeReason('https://calendar.example.org/feed.ics')).not.toMatch(/Moodle/);
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254', // cloud metadata
    '172.16.5.4',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1', // carrier-grade NAT
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1', // mapped: must not walk through as IPv6
    '::127.0.0.1', // compatible form, same trick
    'not an address',
  ])('treats %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['142.250.72.14', '172.32.0.1', '8.8.8.8', '2607:f8b0:4004:c1b::8a'])(
    'treats %s as public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

const inst = (o: Partial<MirrorInstance> & { uid: string; startsAt: string }): MirrorInstance => ({
  title: 'Meeting',
  location: null,
  endsAt: null,
  allDay: false,
  courseId: null,
  kind: 'other',
  ...o,
});

const row = (o: Partial<MirrorRow> & { id: string; feed_uid: string; starts_at: string }): MirrorRow => ({
  ends_at: null,
  title: 'Meeting',
  location: null,
  all_day: false,
  course_id: null,
  kind: 'other',
  ...o,
});

describe('diffMirror', () => {
  it('changes nothing when nothing changed', () => {
    const d = diffMirror(
      [row({ id: '1', feed_uid: 'a', starts_at: '2026-09-15T14:00:00+00:00' })],
      [inst({ uid: 'a', startsAt: '2026-09-15T14:00:00.000Z' })],
    );
    // The two timestamps are the same instant written two ways — Postgres's
    // and JavaScript's. Compared as strings, every row would be "changed" on
    // every sync and the whole calendar rewritten every five minutes.
    expect(d).toEqual({ insert: [], update: [], remove: [] });
  });

  it('inserts what is new and removes what is gone', () => {
    const d = diffMirror(
      [row({ id: 'old', feed_uid: 'gone', starts_at: '2026-09-15T14:00:00Z' })],
      [inst({ uid: 'new', startsAt: '2026-09-16T14:00:00Z' })],
    );
    expect(d.insert.map((i) => i.uid)).toEqual(['new']);
    expect(d.remove).toEqual(['old']);
  });

  it('updates in place when only the details change, keeping the row id', () => {
    const d = diffMirror(
      [row({ id: 'keep', feed_uid: 'a', starts_at: '2026-09-15T14:00:00Z', title: 'Old name' })],
      [inst({ uid: 'a', startsAt: '2026-09-15T14:00:00Z', title: 'New name', location: 'Room 4' })],
    );
    expect(d.insert).toEqual([]);
    expect(d.remove).toEqual([]);
    expect(d.update).toEqual([
      { id: 'keep', title: 'New name', location: 'Room 4', ends_at: null, all_day: false, course_id: null, kind: 'other' },
    ]);
  });

  it('treats a moved meeting as a different occurrence', () => {
    // A new start is a new identity: the old slot goes and the new one comes.
    const d = diffMirror(
      [row({ id: 'x', feed_uid: 'a', starts_at: '2026-09-15T14:00:00Z' })],
      [inst({ uid: 'a', startsAt: '2026-09-15T16:00:00Z' })],
    );
    expect(d.remove).toEqual(['x']);
    expect(d.insert).toHaveLength(1);
  });

  it('tells the weeks of one recurring series apart', () => {
    const d = diffMirror(
      [row({ id: 'w1', feed_uid: 'series', starts_at: '2026-09-07T14:00:00Z' })],
      [
        inst({ uid: 'series', startsAt: '2026-09-07T14:00:00Z' }),
        inst({ uid: 'series', startsAt: '2026-09-14T14:00:00Z' }),
      ],
    );
    expect(d.insert.map((i) => i.startsAt)).toEqual(['2026-09-14T14:00:00Z']);
    expect(d.remove).toEqual([]);
  });

  it('repairs a duplicate rather than keeping it forever', () => {
    const d = diffMirror(
      [
        row({ id: 'first', feed_uid: 'a', starts_at: '2026-09-15T14:00:00Z' }),
        row({ id: 'dupe', feed_uid: 'a', starts_at: '2026-09-15T14:00:00.000Z' }),
      ],
      [inst({ uid: 'a', startsAt: '2026-09-15T14:00:00Z' })],
    );
    expect(d.remove).toEqual(['dupe']);
  });
});

describe('mirrorInsertRows', () => {
  it('writes every key on every row, so one batch cannot fail PGRST102', () => {
    const rows = mirrorInsertRows(
      [
        inst({ uid: 'a', startsAt: '2026-09-15T14:00:00Z', location: 'Room 1', endsAt: '2026-09-15T15:00:00Z' }),
        inst({ uid: 'b', startsAt: '2026-09-16T00:00:00Z', allDay: true }),
      ],
      'user',
      'feed',
    );
    const keys = rows.map((r) => Object.keys(r).sort().join(','));
    expect(new Set(keys).size).toBe(1);
    expect(rows[0]).toMatchObject({ user_id: 'user', feed_id: 'feed', feed_uid: 'a', kind: 'other' });
  });
});

describe('fingerprintInstances', () => {
  const a = inst({ uid: 'a', startsAt: '2026-09-15T14:00:00Z', title: 'Lab' });
  const b = inst({ uid: 'b', startsAt: '2026-09-16T14:00:00Z', title: 'Seminar' });

  it('does not care what order the provider emitted events in', () => {
    expect(fingerprintInstances([a, b], [])).toBe(fingerprintInstances([b, a], []));
  });

  it('does not care how a timestamp was written', () => {
    const same = { ...a, startsAt: '2026-09-15T14:00:00.000Z' };
    expect(fingerprintInstances([a], [])).toBe(fingerprintInstances([same], []));
  });

  it.each([
    ['a retitle', { title: 'Lab, moved' }],
    ['a new location', { location: 'Room 4' }],
    ['a new time', { startsAt: '2026-09-15T15:00:00Z' }],
    ['a new end', { endsAt: '2026-09-15T16:00:00Z' }],
  ])('changes on %s', (_, patch) => {
    expect(fingerprintInstances([a], [])).not.toBe(fingerprintInstances([{ ...a, ...patch }], []));
  });

  it('changes when an event appears or disappears', () => {
    expect(fingerprintInstances([a], [])).not.toBe(fingerprintInstances([a, b], []));
  });

  it('changes when what could not be read changes', () => {
    expect(fingerprintInstances([a], [])).not.toBe(fingerprintInstances([a], ['"X" repeats oddly']));
  });
});

describe('reading a mirrored event', () => {
  // Real titles from a Concordia timetable and its course platforms.
  it.each([
    ['H435 - MATH 205-J - LEC', 'MATH 205'],
    ['MB S2.210 - COEN 231-U - LEC', 'COEN 231'],
    ['FB S150 - COEN 231-U UA - TUT', 'COEN 231'],
    ['REMOTE - MATH 205-RMT2 - TUT', 'MATH 205'],
    ['TBA - COEN 212-FO-X - LAB', 'COEN 212'],
    ['PHYS 205 - Quiz #3 is due', 'PHYS 205'],
    ['📖 PHYS 205 Study', 'PHYS 205'],
    ['Assignment 1 is due', null],
    ['🍗 Gym', null],
  ])('finds the course in %s', (title, code) => {
    expect(courseCodeOf(title)).toBe(code);
  });

  it('does not read a room number as a course', () => {
    expect(courseCodeOf('H435 lecture hall')).toBeNull();
  });

  it('compares codes however they were typed', () => {
    expect(normaliseCode('coen212')).toBe('COEN 212');
    expect(normaliseCode('COEN-212')).toBe('COEN 212');
  });

  it.each([
    ['Midterm Exam', 'exam'],
    ['PHYS 205 Midterm', 'exam'],
    ['TBA - COEN 212-FO-X - LAB', 'lab'],
    ['MB S2.330 - COEN 212-F - LEC', 'other'],
    // Mentions an exam; is not one. Calling it one would send a false
    // night-before warning.
    ['MATH 205 - Practice Problems Midterm (NOT MANDATORY) Due', 'other'],
    ['Deadline to submit documentation for exam accommodations', 'other'],
    ['Lab report due', 'other'],
  ])('reads %s as %s', (title, kind) => {
    expect(kindOf(title)).toBe(kind);
  });
});

describe('duplicatesTracked', () => {
  const at = '2026-09-27T03:59:00.000Z';

  it('hides a platform deadline that is already a piece of work', () => {
    expect(duplicatesTracked({ startsAt: at, title: 'PHYS 205 - Quiz #3 is due' }, [{ at, title: 'Quiz 3' }])).toBe(true);
    expect(
      duplicatesTracked({ startsAt: at, title: 'MATH 205 - Assignment 4 Due (WeBWorK)' }, [{ at, title: 'WeBWorK 4' }]),
    ).toBe(true);
  });

  it('hides a mirrored exam that the account already has', () => {
    const t = '2026-10-31T18:00:00.000Z';
    expect(duplicatesTracked({ startsAt: t, title: 'Midterm Exam' }, [{ at: t, title: 'PHYS 205 Midterm' }])).toBe(true);
  });

  it('keeps it when the time differs — that is how a moved deadline shows up', () => {
    expect(
      duplicatesTracked({ startsAt: '2026-09-28T03:59:00.000Z', title: 'Quiz 3 is due' }, [{ at, title: 'Quiz 3' }]),
    ).toBe(false);
  });

  it('keeps it when only the time matches', () => {
    // A lecture and a deadline can share an instant without being one fact.
    expect(duplicatesTracked({ startsAt: at, title: 'Office hours' }, [{ at, title: 'Quiz 3' }])).toBe(false);
  });
});

describe('mirrored rows carry their labels', () => {
  it('writes the course and kind the sync worked out', () => {
    const [r] = mirrorInsertRows([inst({ uid: 'a', startsAt: at0, courseId: 'c1', kind: 'exam' })], 'u', 'f');
    expect(r).toMatchObject({ course_id: 'c1', kind: 'exam' });
  });

  it('updates a row whose course link changed, keeping its id', () => {
    const d = diffMirror(
      [row({ id: 'k', feed_uid: 'a', starts_at: at0 })],
      [inst({ uid: 'a', startsAt: at0, courseId: 'c1' })],
    );
    expect(d.update.map((u) => [u.id, u.course_id])).toEqual([['k', 'c1']]);
  });
});
const at0 = '2026-09-15T14:00:00Z';

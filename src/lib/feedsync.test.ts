import { describe, it, expect } from 'vitest';
import { checkFeedUrl, isPrivateAddress } from '../../supabase/functions/_shared/feedurl';
import { diffMirror, fingerprintSource, mirrorInsertRows, type MirrorRow } from '../../supabase/functions/_shared/feedsync';
import type { FeedInstance } from '../../supabase/functions/_shared/feed';

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

const inst = (o: Partial<FeedInstance> & { uid: string; startsAt: string }): FeedInstance => ({
  title: 'Meeting',
  location: null,
  endsAt: null,
  allDay: false,
  ...o,
});

const row = (o: Partial<MirrorRow> & { id: string; feed_uid: string; starts_at: string }): MirrorRow => ({
  ends_at: null,
  title: 'Meeting',
  location: null,
  all_day: false,
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
      { id: 'keep', title: 'New name', location: 'Room 4', ends_at: null, all_day: false },
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

describe('fingerprintSource', () => {
  const body = (stamp: string, title: string) =>
    ['BEGIN:VEVENT', `DTSTAMP:${stamp}`, 'UID:a', `SUMMARY:${title}`, 'DTSTART:20260915T140000Z', 'END:VEVENT'].join('\r\n');

  it('ignores the download time Google stamps on every event', () => {
    // Two downloads of an unchanged Google calendar, seconds apart.
    expect(fingerprintSource(body('20260923T220652Z', 'Lab'))).toBe(
      fingerprintSource(body('20260923T220656Z', 'Lab')),
    );
  });

  it('still changes when something on the calendar does', () => {
    expect(fingerprintSource(body('20260923T220652Z', 'Lab'))).not.toBe(
      fingerprintSource(body('20260923T220652Z', 'Lab, moved')),
    );
  });

  it('leaves DTSTART alone, which starts with the same letters', () => {
    expect(fingerprintSource(body('x', 'Lab'))).toContain('DTSTART:20260915T140000Z');
  });
});

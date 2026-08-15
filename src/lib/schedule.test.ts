import { describe, it, expect } from 'vitest';
import { decideDigest, type DigestSettings } from '../../supabase/functions/_shared/schedule';

const SETTINGS: DigestSettings = {
  timezone: 'America/Toronto',
  digest_hour: 7,
  digest_minute: 0,
  digest_enabled: true,
};

const utc = (iso: string) => new Date(iso);

describe('decideDigest — 07:00 in Montreal, whatever UTC thinks', () => {
  it('fires at 11:00Z in summer', () => {
    const d = decideDigest(SETTINGS, utc('2026-08-15T11:00:00Z'), false);
    expect(d).toMatchObject({ send: true, localDay: '2026-08-15', minutesLate: 0 });
  });

  it('does NOT fire at 12:00Z in summer — that is 08:00 local, an hour late', () => {
    // Still inside the catch-up window, so it does send, but the lateness is
    // reported rather than hidden. A digest that is quietly an hour off is how
    // you end up not trusting it.
    const d = decideDigest(SETTINGS, utc('2026-08-15T12:00:00Z'), false);
    expect(d).toMatchObject({ send: true, minutesLate: 60 });
  });

  it('fires at 12:00Z in winter', () => {
    const d = decideDigest(SETTINGS, utc('2026-01-15T12:00:00Z'), false);
    expect(d).toMatchObject({ send: true, localDay: '2026-01-15', minutesLate: 0 });
  });

  it('is too early at 11:00Z in winter — that is only 06:00 local', () => {
    const d = decideDigest(SETTINGS, utc('2026-01-15T11:00:00Z'), false);
    expect(d).toMatchObject({ send: false, reason: 'too-early' });
  });
});

describe('the DST transition days themselves', () => {
  it('fires at 11:00Z the morning the clocks spring forward', () => {
    // 8 Mar 2026: 02:00 EST becomes 03:00 EDT, so 07:00 local is 11:00Z.
    const d = decideDigest(SETTINGS, utc('2026-03-08T11:00:00Z'), false);
    expect(d).toMatchObject({ send: true, localDay: '2026-03-08', minutesLate: 0 });
  });

  it('is too early at 11:00Z the morning BEFORE springing forward', () => {
    const d = decideDigest(SETTINGS, utc('2026-03-07T11:00:00Z'), false);
    expect(d).toMatchObject({ send: false, reason: 'too-early' });
  });

  it('fires at 12:00Z the morning the clocks fall back', () => {
    // 1 Nov 2026: 02:00 EDT becomes 01:00 EST, so 07:00 local is 12:00Z.
    const d = decideDigest(SETTINGS, utc('2026-11-01T12:00:00Z'), false);
    expect(d).toMatchObject({ send: true, localDay: '2026-11-01', minutesLate: 0 });
  });

  it('is too early at 11:00Z the morning the clocks fall back', () => {
    // The exact bug this whole design exists to prevent: a fixed 11:00Z cron
    // would deliver the "morning digest" at 06:00 local for four months.
    const d = decideDigest(SETTINGS, utc('2026-11-01T11:00:00Z'), false);
    expect(d).toMatchObject({ send: false, reason: 'too-early' });
  });

  it('never skips a day across either transition', () => {
    // Walk every 15 minutes through both transition weekends and assert that
    // each local day gets exactly one opportunity to send.
    for (const [start, end] of [
      ['2026-03-06T00:00:00Z', '2026-03-11T00:00:00Z'],
      ['2026-10-30T00:00:00Z', '2026-11-04T00:00:00Z'],
    ]) {
      const fired = new Set<string>();
      for (let t = utc(start).getTime(); t < utc(end).getTime(); t += 15 * 60_000) {
        const now = new Date(t);
        const d = decideDigest(SETTINGS, now, fired.has(localDayOf(now)));
        if (d.send) fired.add(d.localDay);
      }
      // Five local days in each window, each fired exactly once.
      expect(fired.size).toBe(5);
    }
  });
});

/** Local day helper mirroring what the caller would track. */
function localDayOf(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

describe('idempotency and the catch-up window', () => {
  it('does not send twice on the same local day', () => {
    const d = decideDigest(SETTINGS, utc('2026-08-15T11:15:00Z'), true);
    expect(d).toMatchObject({ send: false, reason: 'already-sent' });
  });

  it('still sends after an outage, within three hours', () => {
    const d = decideDigest(SETTINGS, utc('2026-08-15T13:59:00Z'), false); // 09:59 local
    expect(d.send).toBe(true);
  });

  it('gives up rather than sending a "morning" digest in the afternoon', () => {
    const d = decideDigest(SETTINGS, utc('2026-08-15T18:00:00Z'), false); // 14:00 local
    expect(d).toMatchObject({ send: false, reason: 'window-missed' });
  });

  it('respects the digest being switched off', () => {
    const d = decideDigest(
      { ...SETTINGS, digest_enabled: false },
      utc('2026-08-15T11:00:00Z'),
      false,
    );
    expect(d).toMatchObject({ send: false, reason: 'disabled' });
  });
});

describe('a reconfigured digest time', () => {
  it('honours a 06:30 setting', () => {
    const s = { ...SETTINGS, digest_hour: 6, digest_minute: 30 };
    expect(decideDigest(s, utc('2026-08-15T10:29:00Z'), false)).toMatchObject({
      send: false,
      reason: 'too-early',
    });
    expect(decideDigest(s, utc('2026-08-15T10:30:00Z'), false)).toMatchObject({ send: true });
  });

  it('honours a late-evening setting without leaking into the next day', () => {
    const s = { ...SETTINGS, digest_hour: 23, digest_minute: 0 };
    // 23:30 local on the 15th — inside the window, still the 15th.
    const d = decideDigest(s, utc('2026-08-16T03:30:00Z'), false);
    expect(d).toMatchObject({ send: true, localDay: '2026-08-15' });

    // 00:30 local on the 16th is a new local day, and 23:00 has not arrived.
    const next = decideDigest(s, utc('2026-08-16T04:30:00Z'), false);
    expect(next).toMatchObject({ send: false, reason: 'too-early', localDay: '2026-08-16' });
  });
});

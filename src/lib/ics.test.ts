import { describe, it, expect } from 'vitest';
import { buildIcs, escapeText, foldLine } from '../../supabase/functions/_shared/ics';

/**
 * RFC 5545 fails silently. A long line, an unescaped comma or an LF instead of
 * a CRLF, and a client accepts the feed and quietly drops events — so these
 * are mostly about the format rules rather than the content.
 */

const at = (iso: string) => new Date(iso);

describe('escapeText', () => {
  it('escapes the characters that would end a property early', () => {
    expect(escapeText('Essay, part 2; final')).toBe('Essay\\, part 2\; final');
  });

  it('escapes backslashes before anything else', () => {
    // Doing it later would escape the escapes already added.
    expect(escapeText('a\\b,c')).toBe('a\\\\b\\,c');
  });

  it('turns newlines into the literal escape, not a real break', () => {
    // A real newline mid-value truncates the property.
    expect(escapeText('line one\nline two')).toBe('line one\\nline two');
    expect(escapeText('crlf\r\nhere')).toBe('crlf\\nhere');
  });
});

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Lab report')).toBe('SUMMARY:Lab report');
  });

  it('folds past 75 octets with a leading space on continuations', () => {
    const long = `SUMMARY:${'a'.repeat(200)}`;
    const folded = foldLine(long);
    expect(folded).toContain('\r\n ');
    for (const piece of folded.split('\r\n')) {
      expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(75);
    }
  });

  it('never splits a multi-byte character', () => {
    // An em dash or an accent broken across a fold is an invalid sequence and
    // a rejected feed.
    const folded = foldLine(`SUMMARY:${'é'.repeat(80)}`);
    for (const piece of folded.split('\r\n')) {
      expect(() => new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(piece))).not.toThrow();
    }
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(80)}`);
  });

  it('counts octets rather than characters', () => {
    // 40 two-byte characters is 80 octets and must fold, even though it is
    // only 40 characters long.
    expect(foldLine('é'.repeat(40))).toContain('\r\n ');
  });
});

describe('buildIcs', () => {
  const base = { name: 'Planner', timezone: 'America/Toronto', now: at('2026-08-19T12:00:00Z') };

  it('wraps events in a valid calendar', () => {
    const out = buildIcs(
      [{ uid: 'a1', start: at('2026-08-21T03:59:00Z'), end: null, allDay: false, summary: 'Lab report' }],
      base,
    );
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(out).toContain('UID:a1');
    expect(out).toContain('SUMMARY:Lab report');
  });

  it('uses CRLF everywhere, never a bare newline', () => {
    const out = buildIcs(
      [{ uid: 'a1', start: at('2026-08-21T03:59:00Z'), end: null, allDay: false, summary: 'X' }],
      base,
    );
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('writes a timed event as a UTC instant', () => {
    const out = buildIcs(
      [{ uid: 'a1', start: at('2026-08-21T03:59:00Z'), end: null, allDay: false, summary: 'X' }],
      base,
    );
    expect(out).toContain('DTSTART:20260821T035900Z');
  });

  it('writes an all-day event as a LOCAL date', () => {
    // 03:59Z is 23:59 on the 20th in Toronto. Formatting the date in UTC would
    // put a Thursday deadline on Friday in the calendar app.
    const out = buildIcs(
      [{ uid: 'a1', start: at('2026-08-21T03:59:00Z'), end: null, allDay: true, summary: 'X' }],
      base,
    );
    expect(out).toContain('DTSTART;VALUE=DATE:20260820');
  });

  it('includes an end when there is one', () => {
    const out = buildIcs(
      [{
        uid: 'e1',
        start: at('2026-10-22T22:00:00Z'),
        end: at('2026-10-23T00:00:00Z'),
        allDay: false,
        summary: 'Midterm',
      }],
      base,
    );
    expect(out).toContain('DTEND:20261023T000000Z');
  });

  it('escapes a summary containing a comma', () => {
    const out = buildIcs(
      [{ uid: 'a1', start: at('2026-08-21T03:59:00Z'), end: null, allDay: false, summary: 'Essay, part 2' }],
      base,
    );
    expect(out).toContain('SUMMARY:Essay\\, part 2');
  });

  it('produces a valid empty calendar rather than nothing', () => {
    // A term with no deadlines yet must still return a subscribable feed, or
    // the calendar app reports the subscription as broken.
    const out = buildIcs([], base);
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).toContain('END:VCALENDAR');
    expect(out).not.toContain('BEGIN:VEVENT');
  });
});

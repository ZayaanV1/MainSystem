import { describe, it, expect } from 'vitest';
import {
  collectSections,
  renderDigest,
  renderTestMessage,
  type DigestSection,
} from '../../supabase/functions/_shared/digest';

const TZ = 'America/Toronto';

/**
 * The digest is the only thing this app says to you when it is not open, so
 * the copy rules matter more here than anywhere else in the interface.
 *
 * CLAUDE.md records that the no-streak-shaming rule "has been violated by
 * well-meaning refactors before". The voice guard at the bottom of this file
 * is a standing check against that happening to the one surface that arrives
 * unannounced at seven in the morning.
 */

describe('the empty digest — Phase 0 ships exactly this', () => {
  it('says nothing is due, and stops', async () => {
    const msg = renderDigest('2026-08-15', [], TZ);
    expect(msg.body).toBe('Nothing due.');
  });

  it('is titled with the local day, not a UTC one', () => {
    const msg = renderDigest('2026-08-15', [], TZ);
    expect(msg.title).toContain('Aug 15');
    expect(msg.title).toContain('Sat');
  });

  it('carries the deep link when the app URL is known', () => {
    const msg = renderDigest('2026-08-15', [], TZ, 'https://planner.example');
    expect(msg.deepLink).toBe('https://planner.example');
  });

  it('is still a message when no app URL is configured', () => {
    // Silence is indistinguishable from a broken pipeline, so a missing
    // deep link must never suppress the send.
    const msg = renderDigest('2026-08-15', [], TZ);
    expect(msg.body.length).toBeGreaterThan(0);
    expect(msg.deepLink).toBeUndefined();
  });

  it('returns no sections while the Phase 1 tables do not exist', async () => {
    expect(await collectSections({}, 'u1', {
      timezone: TZ,
      assignment_window_days: 7,
      event_window_days: 14,
    }, '2026-08-15')).toEqual([]);
  });
});

describe('a digest with content', () => {
  const sections: DigestSection[] = [
    { heading: 'Overdue', items: ['Chem lab report'] },
    { heading: 'Due this week', items: ['Essay draft, Tuesday', 'Problem set 4, Friday'] },
  ];

  it('groups items under their headings', () => {
    const msg = renderDigest('2026-08-15', sections, TZ);
    expect(msg.body).toBe(
      'Overdue\n- Chem lab report\n\nDue this week\n- Essay draft, Tuesday\n- Problem set 4, Friday',
    );
  });

  it('puts overdue first, because that is the order it was given', () => {
    const msg = renderDigest('2026-08-15', sections, TZ);
    expect(msg.body.indexOf('Overdue')).toBeLessThan(msg.body.indexOf('Due this week'));
  });
});

describe('the test message is distinguishable from a real digest', () => {
  it('says plainly that it is a test', () => {
    // A test notification that looks identical to the real thing cannot be
    // used to diagnose anything.
    const msg = renderTestMessage('2026-08-15', TZ);
    expect(msg.title).toBe('Test notification');
    expect(msg.body).toContain('Delivery is working');
  });
});

describe('copy voice', () => {
  const samples = [
    renderDigest('2026-08-15', [], TZ),
    renderDigest('2026-11-01', [{ heading: 'Overdue', items: ['Chem lab report'] }], TZ),
    renderTestMessage('2026-08-15', TZ),
  ];

  const EMOJI = /\p{Extended_Pictographic}/u;

  it('uses no emoji', () => {
    for (const m of samples) {
      expect(EMOJI.test(m.title), m.title).toBe(false);
      expect(EMOJI.test(m.body), m.body).toBe(false);
    }
  });

  it('uses no exclamation marks', () => {
    for (const m of samples) {
      expect(`${m.title} ${m.body}`).not.toContain('!');
    }
  });

  it('never praises, laments, or apologises', () => {
    // Nothing was earned, so saying so is a lie the reader can feel — and an
    // app that congratulates you on a good day is one that indicts you on a
    // bad one.
    const banned =
      /\b(great|well done|nice work|good job|congrat\w*|amazing|awesome|oops|sorry|unfortunately|sadly|uh oh)\b/i;

    for (const m of samples) {
      expect(banned.test(`${m.title} ${m.body}`), `${m.title} / ${m.body}`).toBe(false);
    }
  });

  it('never counts streaks or missed days', () => {
    // The rule this project has broken before. Missed days appear neutrally
    // and are back-fillable; they are never tallied at you.
    const banned = /\b(streak|in a row|days? missed|missed \d+|you'?ve missed|behind by)\b/i;

    for (const m of samples) {
      expect(banned.test(`${m.title} ${m.body}`), `${m.title} / ${m.body}`).toBe(false);
    }
  });
});

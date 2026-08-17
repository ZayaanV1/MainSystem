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

/**
 * A PostgREST-shaped fake that actually applies its filters, so the window
 * boundaries and the overdue split are genuinely exercised rather than
 * assumed. Seeding only the rows that should come back would test nothing.
 */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b),
        neq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] !== v)), b),
        gte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) >= v)), b),
        lte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) <= v)), b),
        not: (c: string, _op: string, v: unknown) =>
          ((rows = rows.filter((r) => r[c] !== v)), b),
        order: (c: string) => (
          (rows = [...rows].sort((x, y) => String(x[c]).localeCompare(String(y[c])))), b
        ),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return b;
    },
  };
}

const SETTINGS = { timezone: TZ, assignment_window_days: 7, event_window_days: 14 };
const USER = 'u1';
const DAY = '2026-09-14'; // a Monday

/** 23:59 local on a Toronto day, as a stored UTC instant. */
const dueEndOf = (day: string) => `${day}T03:59:00.000Z`.replace(day, shiftBack(day));
function shiftBack(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
/** Noon local on a Toronto day (EDT), as a stored UTC instant. */
const noon = (day: string) => `${day}T16:00:00.000Z`;

describe('the real digest', () => {
  const db = () =>
    fakeDb({
      assignments: [
        { user_id: USER, status: 'todo', title: 'Chem lab report', due_at: noon('2026-09-10') },
        { user_id: USER, status: 'todo', title: 'Essay draft', due_at: noon('2026-09-14') },
        { user_id: USER, status: 'todo', title: 'Problem set 4', due_at: noon('2026-09-18') },
        { user_id: USER, status: 'todo', title: 'Far future paper', due_at: noon('2026-11-01') },
        { user_id: USER, status: 'done', title: 'Already finished', due_at: noon('2026-09-15') },
        { user_id: 'other', status: 'todo', title: 'Someone else', due_at: noon('2026-09-15') },
      ],
      events: [
        { user_id: USER, title: 'Midterm exam', starts_at: noon('2026-09-22'), kind: 'exam' },
        { user_id: USER, title: 'Distant final', starts_at: noon('2026-12-10'), kind: 'exam' },
      ],
      checklist_items: [
        {
          id: 'med',
          user_id: USER,
          title: 'Adderall XR 20mg',
          recurrence: 'daily',
          active: true,
          sort_order: 1,
          tracks_doses: true,
          doses_remaining: 2,
          doses_per_completion: 1,
          refill_warning_days: 3,
        },
        {
          id: 'cre',
          user_id: USER,
          title: 'Creatine',
          recurrence: 'daily',
          active: true,
          sort_order: 2,
          tracks_doses: false,
          doses_remaining: null,
          doses_per_completion: 1,
          refill_warning_days: 7,
        },
      ],
      checklist_completions: [{ user_id: USER, item_id: 'cre', local_day: DAY }],
    });

  it('calls overdue work out first', async () => {
    const s = await collectSections(db(), USER, SETTINGS, DAY);
    expect(s[0].heading).toBe('Overdue');
    expect(s[0].items).toEqual(['Chem lab report — 4 days ago']);
  });

  it('lists what is due inside the window, and nothing beyond it', async () => {
    const s = await collectSections(db(), USER, SETTINGS, DAY);
    const upcoming = s.find((x) => x.heading.startsWith('Due in'))!;
    expect(upcoming.items).toEqual(['Essay draft — today', 'Problem set 4 — Fri, Sep 18']);
  });

  it('excludes finished work and other people’s work', async () => {
    const all = (await collectSections(db(), USER, SETTINGS, DAY))
      .flatMap((s) => s.items)
      .join(' ');
    expect(all).not.toContain('Already finished');
    expect(all).not.toContain('Someone else');
  });

  it('uses the wider window for events', async () => {
    const s = await collectSections(db(), USER, SETTINGS, DAY);
    const events = s.find((x) => x.heading.startsWith('Coming up'))!;
    expect(events.items).toEqual(['Midterm exam — Tue, Sep 22, in 8 days']);
  });

  it('lists only checklist items still outstanding today', async () => {
    const s = await collectSections(db(), USER, SETTINGS, DAY);
    const today = s.find((x) => x.heading === 'Today')!;
    // Creatine was already ticked off, so it is absent rather than shown done.
    expect(today.items).toEqual(['Adderall XR 20mg (2 left, 2 days — time to refill)']);
  });

  it('omits empty sections rather than writing "none"', async () => {
    const quiet = fakeDb({
      assignments: [],
      events: [],
      checklist_items: [],
      checklist_completions: [],
    });
    expect(await collectSections(quiet, USER, SETTINGS, DAY)).toEqual([]);
  });

  it('produces a message a person can act on', async () => {
    const msg = renderDigest(DAY, await collectSections(db(), USER, SETTINGS, DAY), TZ);
    expect(msg.title).toBe('Mon, Sep 14');
    expect(msg.body).toBe(
      [
        'Overdue',
        '- Chem lab report — 4 days ago',
        '',
        'Due in the next 7 days',
        '- Essay draft — today',
        '- Problem set 4 — Fri, Sep 18',
        '',
        'Coming up in 14 days',
        '- Midterm exam — Tue, Sep 22, in 8 days',
        '',
        'Today',
        '- Adderall XR 20mg (2 left, 2 days — time to refill)',
      ].join('\n'),
    );
  });

  it('never scolds, even with overdue work in it', async () => {
    const msg = renderDigest(DAY, await collectSections(db(), USER, SETTINGS, DAY), TZ);
    const banned = /you|your|still|again|behind|should|forgot|!|streak/i;
    expect(banned.test(msg.body), msg.body).toBe(false);
  });
});

describe('the window edges', () => {
  const onDay = (day: string) =>
    fakeDb({
      assignments: [{ user_id: USER, status: 'todo', title: 'Edge', due_at: dueEndOf(day) }],
      events: [],
      checklist_items: [],
      checklist_completions: [],
    });

  it('includes work due on the last day of the window', async () => {
    // Window is 7 days from 14 Sep, so 21 Sep at 23:59 local is the last
    // moment that counts. Excluding it would silently drop a real deadline.
    const s = await collectSections(onDay('2026-09-21'), USER, SETTINGS, DAY);
    expect(s.flatMap((x) => x.items)).toHaveLength(1);
  });

  it('excludes work due the day after the window', async () => {
    const s = await collectSections(onDay('2026-09-22'), USER, SETTINGS, DAY);
    expect(s).toEqual([]);
  });
});

describe('the empty digest — the branch hardest to notice being broken', () => {
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

  it('is what a genuinely clear day produces', async () => {
    // Not a placeholder branch: this is the message that goes out on a quiet
    // morning, and it is the one hardest to notice being broken, because a
    // digest that never arrives looks exactly like a week with nothing due.
    const quiet = fakeDb({
      assignments: [],
      events: [],
      checklist_items: [],
      checklist_completions: [],
    });
    const sections = await collectSections(quiet, 'u1', SETTINGS, '2026-08-15');
    expect(renderDigest('2026-08-15', sections, TZ).body).toBe('Nothing due.');
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

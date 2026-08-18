import { describe, it, expect } from 'vitest';
import {
  assignmentReminderKey,
  assignmentRemindersDue,
  checklistReminderKey,
  checklistRemindersDue,
  renderReminder,
  type RemindableAssignment,
  type RemindableItem,
} from '../../supabase/functions/_shared/reminders';

const TZ = 'America/Toronto';
const DAY = '2026-08-18'; // a Tuesday
const at = (iso: string) => new Date(iso);

const item = (o: Partial<RemindableItem> & { id: string }): RemindableItem => ({
  title: o.id,
  recurrence: 'daily',
  weekdays: null,
  interval_days: null,
  anchor_day: null,
  active: true,
  sort_order: 0,
  essential: false,
  tracks_doses: false,
  doses_remaining: null,
  doses_per_completion: 1,
  refill_warning_days: 3,
  remind_at: '08:00',
  ...o,
});

const none = new Set<string>();

describe('checklist reminders', () => {
  it('fires when its time arrives', () => {
    // 08:00 EDT is 12:00Z.
    const due = checklistRemindersDue([item({ id: 'meds' })], none, DAY, at('2026-08-18T12:00:00Z'), TZ);
    expect(due.map((i) => i.id)).toEqual(['meds']);
  });

  it('does not fire early', () => {
    expect(checklistRemindersDue([item({ id: 'meds' })], none, DAY, at('2026-08-18T11:45:00Z'), TZ)).toEqual([]);
  });

  it('still fires shortly after, so a missed tick does not lose it', () => {
    const due = checklistRemindersDue([item({ id: 'meds' })], none, DAY, at('2026-08-18T12:25:00Z'), TZ);
    expect(due).toHaveLength(1);
  });

  it('gives up rather than arriving hours late', () => {
    expect(checklistRemindersDue([item({ id: 'meds' })], none, DAY, at('2026-08-18T15:00:00Z'), TZ)).toEqual([]);
  });

  it('says nothing about something already ticked', () => {
    // The rule that decides whether this feature is useful or hateful.
    const done = new Set(['meds']);
    expect(checklistRemindersDue([item({ id: 'meds' })], done, DAY, at('2026-08-18T12:00:00Z'), TZ)).toEqual([]);
  });

  it('says nothing about an item not due today', () => {
    const weekend = item({ id: 'gym', recurrence: 'weekdays', weekdays: [6, 7] });
    expect(checklistRemindersDue([weekend], none, DAY, at('2026-08-18T12:00:00Z'), TZ)).toEqual([]);
  });

  it('ignores an item with no reminder set', () => {
    expect(checklistRemindersDue([item({ id: 'quiet', remind_at: null })], none, DAY, at('2026-08-18T12:00:00Z'), TZ)).toEqual([]);
  });

  it('accepts a time with seconds, as Postgres returns it', () => {
    const due = checklistRemindersDue([item({ id: 'meds', remind_at: '08:00:00' })], none, DAY, at('2026-08-18T12:00:00Z'), TZ);
    expect(due).toHaveLength(1);
  });

  it('survives a nonsense time rather than throwing', () => {
    expect(() =>
      checklistRemindersDue([item({ id: 'x', remind_at: 'later' })], none, DAY, at('2026-08-18T12:00:00Z'), TZ),
    ).not.toThrow();
  });

  it('holds its wall-clock time across a DST change', () => {
    // 08:00 EST on 2 Nov is 13:00Z, an hour later in UTC than in August — the
    // reminder still arrives at 08:00 for the person.
    const due = checklistRemindersDue([item({ id: 'meds' })], none, '2026-11-02', at('2026-11-02T13:00:00Z'), TZ);
    expect(due).toHaveLength(1);
  });
});

describe('assignment reminders', () => {
  const work = (o: Partial<RemindableAssignment> & { id: string }): RemindableAssignment => ({
    title: o.id,
    status: 'todo',
    remind_at: '2026-08-18T18:00:00.000Z',
    ...o,
  });

  it('fires at its instant', () => {
    expect(assignmentRemindersDue([work({ id: 'essay' })], at('2026-08-18T18:00:00Z')).map((a) => a.id)).toEqual(['essay']);
  });

  it('does not fire early or hours late', () => {
    expect(assignmentRemindersDue([work({ id: 'essay' })], at('2026-08-18T17:50:00Z'))).toEqual([]);
    expect(assignmentRemindersDue([work({ id: 'essay' })], at('2026-08-18T20:00:00Z'))).toEqual([]);
  });

  it('says nothing about finished work', () => {
    expect(assignmentRemindersDue([work({ id: 'essay', status: 'done' })], at('2026-08-18T18:00:00Z'))).toEqual([]);
  });

  it('ignores work with no reminder', () => {
    expect(assignmentRemindersDue([work({ id: 'essay', remind_at: null })], at('2026-08-18T18:00:00Z'))).toEqual([]);
  });
});

describe('the message', () => {
  it('is a name and nothing else', () => {
    // Padding it with encouragement makes it longer without making it more
    // useful, at the moment you are least inclined to read.
    const msg = renderReminder('Adderall XR 20mg');
    expect(msg.title).toBe('Now');
    expect(msg.body).toBe('Adderall XR 20mg');
  });

  it('does not nag, praise or exclaim', () => {
    const msg = renderReminder('Take meds');
    expect(`${msg.title} ${msg.body}`).not.toMatch(/don't forget|remember|you |your |!|still|again/i);
  });
});

describe('idempotency keys', () => {
  it('gives a repeating item a new key each day', () => {
    expect(checklistReminderKey('a', '2026-08-18')).not.toBe(checklistReminderKey('a', '2026-08-19'));
  });

  it('re-arms an assignment reminder when its time is moved', () => {
    // Otherwise a rescheduled reminder would be silently spent already.
    const before = assignmentReminderKey('a', '2026-08-18T18:00:00.000Z');
    const after = assignmentReminderKey('a', '2026-08-19T09:00:00.000Z');
    expect(before).not.toBe(after);
  });

  it('keeps checklist and assignment keys from colliding', () => {
    expect(checklistReminderKey('x', DAY)).not.toBe(assignmentReminderKey('x', DAY));
  });
});

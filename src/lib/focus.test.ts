import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearSession,
  elapsedLabel,
  elapsedMinutes,
  readSession,
  startSession,
} from './focus';

describe('focus session', () => {
  beforeEach(() => clearSession());

  it('has nothing running to begin with', () => {
    expect(readSession()).toBeNull();
  });

  it('survives being read back, which is the whole point of storing it', () => {
    // A timer that dies when the phone backgrounds the browser measures
    // nothing, and a phone backgrounds it the moment you open a PDF.
    startSession('a1', 'Assembly lab');
    const back = readSession();
    expect(back).toMatchObject({ assignmentId: 'a1', title: 'Assembly lab' });
  });

  it('replaces rather than queues, so there is only ever one', () => {
    // Two running timers is two answers to "what am I doing", on a screen
    // whose entire job is to have one.
    startSession('a1', 'First');
    startSession('a2', 'Second');
    expect(readSession()?.assignmentId).toBe('a2');
  });

  it('derives elapsed from the start instant rather than counting ticks', () => {
    const s = startSession('a1', 'Lab');
    const later = s.startedAt + 25 * 60_000;
    expect(elapsedMinutes(s, later)).toBe(25);
  });

  it('rounds to the nearest minute rather than flooring', () => {
    // So the number offered matches the clock the person was just looking at.
    const s = startSession('a1', 'Lab');
    expect(elapsedMinutes(s, s.startedAt + 90_000)).toBe(2);
    expect(elapsedMinutes(s, s.startedAt + 20_000)).toBe(0);
  });

  it('never reports negative time when the clock moves backwards', () => {
    const s = startSession('a1', 'Lab');
    expect(elapsedMinutes(s, s.startedAt - 60_000)).toBe(0);
    expect(elapsedLabel(s, s.startedAt - 60_000)).toBe('00:00');
  });

  it('drops a session older than twelve hours instead of offering it', () => {
    // Someone who started a timer and closed the app must not return tomorrow
    // to a running clock offering to record nine hours against a lab report —
    // a number that wrong would poison the median it feeds.
    startSession('a1', 'Forgotten');
    const stale = { assignmentId: 'a1', title: 'Forgotten', startedAt: Date.now() - 13 * 3600_000 };
    localStorage.setItem('planner.focus', JSON.stringify(stale));
    expect(readSession()).toBeNull();
  });

  it('keeps a long but plausible session', () => {
    const recent = { assignmentId: 'a1', title: 'Deep work', startedAt: Date.now() - 3 * 3600_000 };
    localStorage.setItem('planner.focus', JSON.stringify(recent));
    expect(readSession()?.title).toBe('Deep work');
  });

  it('ignores corrupt storage rather than throwing on load', () => {
    localStorage.setItem('planner.focus', 'not json');
    expect(readSession()).toBeNull();

    localStorage.setItem('planner.focus', JSON.stringify({ assignmentId: 'a1' }));
    expect(readSession()).toBeNull();
  });
});

describe('elapsedLabel', () => {
  const s = { assignmentId: 'a', title: 't', startedAt: 0 };

  it('shows mm:ss under an hour', () => {
    expect(elapsedLabel(s, 0)).toBe('00:00');
    expect(elapsedLabel(s, 65_000)).toBe('01:05');
    expect(elapsedLabel(s, 59 * 60_000 + 59_000)).toBe('59:59');
  });

  it('adds hours past sixty minutes rather than counting to 90', () => {
    expect(elapsedLabel(s, 3600_000)).toBe('1:00:00');
    expect(elapsedLabel(s, 3600_000 + 125_000)).toBe('1:02:05');
  });
});

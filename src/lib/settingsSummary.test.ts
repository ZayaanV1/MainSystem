import { describe, it, expect } from 'vitest';
import { accountValue, clock, featuresValue, lookValue, notificationsValue, textsFirstValue } from './settingsSummary';

const digest = {
  digest_hour: 7,
  digest_minute: 0,
  digest_enabled: true,
  assignment_window_days: 7,
  event_window_days: 14,
  weekly_review_enabled: true,
  weekly_review_weekday: 7,
};

describe('settings row values', () => {
  it('says each in a word or two', () => {
    expect(lookValue('glass', 'dark')).toBe('Glass · Dark');
    expect(lookValue(undefined, 'system')).toBe('Plain · Auto');
    expect(notificationsValue(digest)).toBe('7:00 a.m.');
    expect(notificationsValue({ ...digest, digest_enabled: false })).toBe('Off');
    expect(featuresValue({ hidden: [], modulesOff: [] })).toBe('All on');
    expect(featuresValue({ hidden: ['checklist'], modulesOff: ['grades'] } as never)).toBe('2 off');
    expect(accountValue('America/Toronto')).toBe('Toronto');
    expect(accountValue('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
  });

  it('says nothing it has not checked', () => {
    expect(notificationsValue(null)).toBeNull();
    expect(textsFirstValue(null)).toBeNull();
  });

  it('calls hour 24 midnight, never 12:00 p.m.', () => {
    expect(clock(24)).toBe('midnight');
    expect(clock(0)).toBe('midnight');
    expect(clock(12)).toBe('noon');
    expect(clock(13, 30)).toBe('1:30 p.m.');
    expect(textsFirstValue({ on: true, every: null, from: 8, until: 24, morning: null })).toBe('8:00 a.m. to midnight');
    expect(textsFirstValue({ on: false, every: null, from: 8, until: 24, morning: null })).toBe('Off');
  });
});

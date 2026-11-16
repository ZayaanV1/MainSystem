import { describe, it, expect } from 'vitest';
import { aboodSummary, appearanceSummary, notificationsSummary } from './settingsSummary';

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
  it('says how notifications are set, in one line', () => {
    expect(notificationsSummary('subscribed', digest)).toBe('Push on · digest 7:00 a.m. · weekly review Sun');
    expect(notificationsSummary('denied', { ...digest, digest_enabled: false, weekly_review_enabled: false })).toBe(
      'Notifications blocked · digest off',
    );
  });

  it('says nothing it has not checked', () => {
    expect(notificationsSummary(null, null)).toBeNull();
    expect(aboodSummary(null, null, null)).toBeNull();
  });

  it('reads appearance back', () => {
    expect(appearanceSummary('system', { slip: 'ticket', glass: 'bars', motion: 'full' } as never)).toBe(
      'Auto · ticket slips · glass on bars · full motion',
    );
  });

  it('calls hour 24 midnight, never 12:00 p.m.', () => {
    expect(aboodSummary(null, null, { on: true, every: null, from: 8, until: 24, morning: null })).toBe(
      'texts first 8:00 a.m. to midnight',
    );
  });

  it('says no motion when motion is off', () => {
    expect(appearanceSummary('dark', { slip: 'glass', glass: 'all', motion: 'none' } as never)).toBe(
      'Dark · glass slips · glass everywhere · no motion',
    );
  });

  it('reads Abood back', () => {
    expect(aboodSummary({ groq: true, gemini: false }, true, { on: true, every: null, from: 10, until: 21, morning: 7 })).toBe(
      'Groq key set · Telegram linked · texts first 10:00 a.m. to 9:00 p.m. · morning text 7:00 a.m.',
    );
    expect(aboodSummary({ groq: false, gemini: false }, false, { on: false, every: null, from: 10, until: 21, morning: null })).toBe(
      'shared model · Telegram not linked · never texts first',
    );
  });
});

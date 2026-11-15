import { describe, expect, it } from 'vitest';
import { stampFor } from './Chat';

describe('chat time stamps', () => {
  it('stamps the first message and any after an hour of quiet', () => {
    const a = { created_at: '2026-11-15T14:00:00Z' };
    expect(stampFor(a)).toMatch(/\d/);
    expect(stampFor({ created_at: '2026-11-15T14:30:00Z' }, a)).toBeNull();
    expect(stampFor({ created_at: '2026-11-15T15:30:00Z' }, a)).toMatch(/\d/);
  });
});

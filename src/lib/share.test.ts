import { describe, expect, it } from 'vitest';
import { bearer, SHARE_MAX_CHARS, shareText } from '../../supabase/functions/_shared/share';

describe('the share endpoint', () => {
  it('reads JSON from a Shortcut and plain text alike', () => {
    expect(shareText('{"text":"  lab 3 due fri  "}', 'application/json')).toBe('lab 3 due fri');
    expect(shareText('{"text":["a link","a note"]}', 'application/json')).toBe('a link\na note');
    expect(shareText('read chapter 4', 'text/plain')).toBe('read chapter 4');
  });
  it('refuses an empty or broken share and cuts a long one', () => {
    expect(shareText('{"text":"   "}', 'application/json')).toBeNull();
    expect(shareText('{not json', 'application/json')).toBeNull();
    expect(shareText('x'.repeat(SHARE_MAX_CHARS + 50), null)).toHaveLength(SHARE_MAX_CHARS);
  });
  it('takes only a well-formed bearer key', () => {
    expect(bearer('Bearer abcdefghijklmnopqrstuvwx_-12')).toBe('abcdefghijklmnopqrstuvwx_-12');
    expect(bearer('Bearer short')).toBeNull();
    expect(bearer('abcdefghijklmnopqrstuvwx')).toBeNull();
    expect(bearer(null)).toBeNull();
  });
});

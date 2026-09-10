import { describe, it, expect } from 'vitest';
import { normaliseLink } from './link';

/**
 * The sanitiser has a real security edge, so it is tested like one.
 *
 * A stored `javascript:` URL rendered into an anchor is a script that runs
 * when somebody clicks their own assignment, and the app is the thing that put
 * it on screen. The database constraint is the guarantee; this is the
 * convenience layer, and both have to agree.
 */
describe('normaliseLink', () => {
  it('keeps a normal https link', () => {
    expect(normaliseLink('https://moodle.example.edu/x')).toBe('https://moodle.example.edu/x');
  });

  it('adds https when a scheme is missing, because that is what people paste', () => {
    expect(normaliseLink('moodle.example.edu/x')).toBe('https://moodle.example.edu/x');
  });

  it('allows plain http rather than silently upgrading it', () => {
    // Some university hosts are still http, and rewriting the scheme would
    // produce a link that does not resolve while looking correct.
    expect(normaliseLink('http://old.example.edu/a')).toBe('http://old.example.edu/a');
  });

  it('refuses javascript:', () => {
    expect(normaliseLink('javascript:alert(1)')).toBeNull();
    expect(normaliseLink('JavaScript:alert(1)')).toBeNull();
  });

  it('refuses other schemes that are not the web', () => {
    expect(normaliseLink('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(normaliseLink('file:///etc/passwd')).toBeNull();
    expect(normaliseLink('vbscript:msgbox(1)')).toBeNull();
  });

  it('treats blank and whitespace as absent rather than as a link', () => {
    expect(normaliseLink('')).toBeNull();
    expect(normaliseLink('   ')).toBeNull();
    expect(normaliseLink(null)).toBeNull();
  });

  it('refuses something that is not a URL at all', () => {
    expect(normaliseLink('see the email')).toBeNull();
  });

  it('bounds the length, matching the column', () => {
    const long = 'https://example.edu/' + 'a'.repeat(4000);
    expect((normaliseLink(long) ?? '').length).toBeLessThanOrEqual(2000);
  });
});

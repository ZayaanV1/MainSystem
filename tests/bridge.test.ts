import { describe, it, expect } from 'vitest';
import { decodeAttributedBody } from '../bridge/imessage/bridge.mjs';

/**
 * The Mac bridge reads message text out of Messages' attributedBody when the
 * plain text column is empty, which since Ventura it often is. The fixture is
 * the typedstream prefix Messages writes, with the string after it.
 */
const PREFIX =
  '040b73747265616d747970656481e803840140848484124e5341747472696275746564537472696e67008484084e534f626a656374008592848484084e53537472696e67019484012b';

function archived(text: string): string {
  const t = Buffer.from(text, 'utf8');
  const len = t.length < 0x80 ? Buffer.from([t.length]) : Buffer.from([0x81, t.length & 255, t.length >> 8]);
  return Buffer.concat([Buffer.from(PREFIX, 'hex'), len, t, Buffer.from('8684', 'hex')]).toString('hex');
}

describe('decodeAttributedBody', () => {
  it('reads a short message', () => {
    expect(decodeAttributedBody(archived('What is due this week?'))).toBe('What is due this week?');
  });

  it('reads a long one with a two-byte length, and keeps emoji intact', () => {
    const long = 'Remind me about the lab 🧪 '.repeat(12).trim();
    expect(decodeAttributedBody(archived(long))).toBe(long);
  });

  it('returns nothing for a body with no string in it', () => {
    expect(decodeAttributedBody('')).toBeNull();
    expect(decodeAttributedBody('0102030405')).toBeNull();
  });
});

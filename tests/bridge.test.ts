import { describe, it, expect } from 'vitest';
import { decodeAttributedBody, mayForward, normaliseHandle } from '../bridge/imessage/bridge.mjs';

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

/**
 * The bridge used to post every incoming direct message to the cloud and let
 * the server throw away the ones from strangers. By then the text had already
 * left the Mac. These pin the rule that only linked senders, and link codes,
 * are forwarded.
 */
describe('what may leave the Mac', () => {
  const linked = new Set(['+15145550100', 'friend@example.com']);

  it('forwards a message from a linked number, however it is written', () => {
    expect(mayForward('+15145550100', 'when is my lab due', linked)).toBe(true);
    expect(mayForward('+1 514 555 0100', 'hi', linked)).toBe(true);
    // No country code is a different handle, as the planner treats it.
    expect(mayForward('(514) 555-0100', 'hi', linked)).toBe(false);
  });

  it('forwards from a linked Apple ID regardless of case', () => {
    expect(mayForward('Friend@Example.com', 'hello', linked)).toBe(true);
  });

  it('drops everyone else, including a code that looks like a bank message', () => {
    expect(mayForward('+15145559999', 'Your code is 481516', linked)).toBe(false);
    expect(mayForward('stranger@example.com', 'private thing', linked)).toBe(false);
  });

  it('lets a link code through from a sender who is not linked yet', () => {
    expect(mayForward('+15145559999', 'link abcdefghijklmnop', linked)).toBe(true);
    expect(mayForward('+15145559999', 'link short', linked)).toBe(false);
  });

  it('normalises handles the way the planner does', () => {
    expect(normaliseHandle('Friend@Example.com')).toBe('friend@example.com');
    expect(normaliseHandle('514-555-0100')).toBe('+5145550100');
    expect(normaliseHandle('+1 (514) 555-0100')).toBe('+15145550100');
  });
});

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

describe('Claude on the Mac', () => {
  it('asks Claude Code for one structured answer with no tools, settings or saved session', async () => {
    const { claudeArgs } = await import('../bridge/imessage/bridge.mjs');
    const args = claudeArgs({}, { instruction: 'You are Abood.', schema: { type: 'object' }, reasoning: 'medium' });
    expect(args).toEqual(expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config']));
    expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-5-5');
    expect(args[args.indexOf('--effort') + 1]).toBe('medium');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('You are Abood.');
  });

  it('reads the structured answer, and refuses an error rather than sending it as a text', async () => {
    const { readClaude } = await import('../bridge/imessage/bridge.mjs');
    expect(readClaude(JSON.stringify({ is_error: false, structured_output: { reply: 'FIRST 10K??' } }))).toEqual({ reply: 'FIRST 10K??' });
    expect(readClaude(JSON.stringify({ is_error: false, result: '```json\n{"reply":"yo"}\n```' }))).toEqual({ reply: 'yo' });
    expect(() => readClaude(JSON.stringify({ is_error: true, result: 'Failed to authenticate' }))).toThrow(/authenticate/);
  });
});

describe('the relayed model', () => {
  it('replays the answers it was given, then asks for the next one with the exact request', async () => {
    const { relayProvider, NeedModel } = await import('../supabase/functions/_shared/llm/relay');
    const p = relayProvider([{ reply: 'one' }]);
    const req = { instruction: 'i', input: 'in', schema: {} };
    expect(await p.complete(req)).toEqual({ ok: true, value: { reply: 'one' }, provider: 'claude' });
    await expect(p.complete(req)).rejects.toBeInstanceOf(NeedModel);
  });
});

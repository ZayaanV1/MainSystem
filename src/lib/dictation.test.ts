import { describe, expect, it } from 'vitest';
import { appendSpoken, dictationMessage } from './dictation';

describe('appendSpoken', () => {
  it('fills an empty field with what was said', () => {
    expect(appendSpoken('', ' lab report thursday ')).toBe('lab report thursday');
  });

  it('adds speech after typed text with one space', () => {
    expect(appendSpoken('email the TA  ', 'about the extension')).toBe('email the TA about the extension');
  });

  it('leaves the field alone when nothing was heard', () => {
    expect(appendSpoken('half typed', '   ')).toBe('half typed');
  });
});

describe('dictationMessage', () => {
  it('says nothing when there is no error', () => {
    expect(dictationMessage(null)).toBeNull();
  });

  it('never apologises or exclaims', () => {
    for (const e of ['denied', 'no-speech', 'failed'] as const) {
      const m = dictationMessage(e) ?? '';
      expect(m).not.toMatch(/sorry|!/i);
    }
  });
});

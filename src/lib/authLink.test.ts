import { describe, expect, it } from 'vitest';
import { readAuthLink } from './authLink';

describe('readAuthLink', () => {
  it('reads a recovery link', () => {
    const link = readAuthLink('#access_token=aaa&expires_in=3600&refresh_token=bbb&token_type=bearer&type=recovery');
    expect(link).toEqual({ tokens: { access_token: 'aaa', refresh_token: 'bbb' }, type: 'recovery', error: null });
  });

  it('reads a confirmation link as a sign-in, not a recovery', () => {
    expect(readAuthLink('#access_token=a&refresh_token=b&type=signup')?.type).toBe('signup');
  });

  it('reports an expired link in words', () => {
    const link = readAuthLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(link?.tokens).toBeNull();
    expect(link?.error).toBe('Email link is invalid or has expired');
  });

  it('ignores fragments that are not auth links', () => {
    expect(readAuthLink('')).toBeNull();
    expect(readAuthLink('#')).toBeNull();
    expect(readAuthLink('#section-2')).toBeNull();
  });

  it('does not sign in from half a token pair', () => {
    expect(readAuthLink('#access_token=a&type=recovery')?.tokens).toBeNull();
  });
});

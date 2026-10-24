import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Every function is deployed with verify_jwt = false (supabase/config.toml), so
 * the platform checks nothing and each one must check for itself. That is easy
 * to get wrong silently: a new function copied without its gate is open to the
 * internet and nothing fails. This reads the source and requires each function
 * to name the way it authenticates callers.
 */
describe('every edge function authenticates its own callers', () => {
  const GATES: Record<string, RegExp> = {
    assist: /auth\.getUser\(/,
    dispatch: /sameSecret\(presented, CRON_SECRET\)[\s\S]*auth\.getUser\(/,
    feeds: /sameSecret\(presented, CRON_SECRET\)[\s\S]*auth\.getUser\(/,
    checkin: /sameSecret\([^)]*x-cron-secret/,
    telegram: /sameSecret\([^)]*x-telegram-bot-api-secret-token/,
    imessage: /bridgeOwner\(/,
    // Public by design: a calendar app cannot present a login. The token is
    // the credential, and a miss is a bare 404.
    calendar: /ics_token/,
  };

  const functions = readdirSync('supabase/functions', { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared')
    .map((d) => d.name)
    .sort();

  it('knows every function there is', () => {
    expect(functions).toEqual(Object.keys(GATES).sort());
  });

  for (const name of Object.keys(GATES)) {
    it(`${name} checks before it reads or writes`, () => {
      const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
      expect(source).toMatch(GATES[name]);
      // No private comparison of its own: the shared one refuses empty secrets.
      expect(source).not.toMatch(/function (sameSecret|timingSafeEqual)\(/);
      // Nor its own copy of the CORS rule, which had already drifted once.
      expect(source).not.toMatch(/function corsFor\(/);
    });
  }
});

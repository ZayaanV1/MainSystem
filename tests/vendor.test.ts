import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

/**
 * @supabase/storage-js is aliased to a stub (src/lib/vendor/storage-stub.ts)
 * to keep the first screen inside its JavaScript budget. That is only safe
 * while the client still builds and nothing uses storage; both are checked
 * here, so the stub cannot quietly break sign-in or a future upload.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

// Node 20 has no WebSocket, and the realtime client wants one to construct.
// Unrelated to the stub; the browser has its own.
class NoSocket {}
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: NoSocket as never },
};

describe('the storage stub', () => {
  it('lets the real client build, with its query and auth parts intact', () => {
    const client = createClient('http://localhost:54321', 'anon-key', options);
    expect(typeof client.from('assignments').select).toBe('function');
    expect(typeof client.rpc).toBe('function');
    expect(typeof client.auth.getSession).toBe('function');
  });

  it('throws on use rather than failing silently', () => {
    const client = createClient('http://localhost:54321', 'anon-key', options);
    expect(() => client.storage.from('avatars')).toThrow(/not bundled/);
  });

  it('is never needed: nothing in the app reads supabase.storage', () => {
    const offenders = sourceFiles('src').filter((f) => /\.storage\b/.test(readFileSync(f, 'utf8')) && !f.includes('vendor'));
    expect(offenders, `storage is stubbed; remove the alias in vite.config.ts before using it:\n${offenders.join('\n')}`).toEqual([]);
  });
});

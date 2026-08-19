#!/usr/bin/env node
/**
 * Set an edge-function secret.
 *
 *   npm run secret GEMINI_API_KEY=AIza...
 *
 * Exists for the same reason `set:url` does: `npx supabase secrets set` needs
 * an access token that lives in .env.setup, and a bare command has no way to
 * know that — it fails with "Access token not provided", which says nothing
 * about the actual cause.
 *
 * The value is never echoed back.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const parse = (path) => {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
};

const cfg = parse(join(root, '.env.setup'));

if (!cfg.SUPABASE_ACCESS_TOKEN) {
  console.error('No SUPABASE_ACCESS_TOKEN in .env.setup. Run `npm run setup` first.');
  process.exit(1);
}

const pairs = process.argv.slice(2).filter((a) => a.includes('='));

if (pairs.length === 0) {
  console.error(`Give it one or more NAME=value pairs:

  npm run secret GEMINI_API_KEY=your-key-here

The value is sent straight to Supabase and never printed.`);
  process.exit(1);
}

const names = pairs.map((p) => p.slice(0, p.indexOf('=')));

try {
  execFileSync('npx', ['--yes', 'supabase', 'secrets', 'set', ...pairs], {
    cwd: root,
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: cfg.SUPABASE_ACCESS_TOKEN },
    stdio: 'pipe',
  });
} catch (e) {
  console.error('The Supabase CLI rejected that.');
  console.error(String(e.stderr ?? e.stdout ?? e.message).slice(0, 400));
  process.exit(1);
}

console.log(`Set: ${names.join(', ')}`);
console.log('Edge functions pick it up on their next cold start, within a minute or so.');

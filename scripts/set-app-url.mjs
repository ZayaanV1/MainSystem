#!/usr/bin/env node
/**
 * Points the backend at the deployed app.
 *
 *   npm run set:url https://your-app.vercel.app
 *
 * Exists because `npx supabase secrets set` needs an access token that lives in
 * .env.setup, and a bare terminal command has no way to know that. Rather than
 * asking anyone to remember an environment-variable prefix, this reads the
 * token the same way setup does.
 *
 * APP_URL is what makes tapping a notification open the planner. Until it is
 * set it defaults to localhost, which is a dead link on a phone.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseEnv(path) {
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
}

const cfg = parseEnv(join(root, '.env.setup'));

if (!cfg.SUPABASE_ACCESS_TOKEN) {
  console.error(
    'No SUPABASE_ACCESS_TOKEN in .env.setup. Run `npm run setup` first, or add it to that file.',
  );
  process.exit(1);
}

const url = (process.argv[2] ?? '').trim().replace(/\/+$/, '');

if (!url) {
  console.error(`Give it the deployed URL:

  npm run set:url https://your-app.vercel.app

Get that from your Vercel dashboard after the first deploy finishes.`);
  process.exit(1);
}

if (!/^https:\/\/[^/\s]+$/.test(url)) {
  console.error(`"${url}" does not look like a deployed origin.

It needs to be https, with no path on the end — for example:
  https://mainsystem-abc123.vercel.app`);
  process.exit(1);
}

console.log(`Setting APP_URL to ${url} ...`);

try {
  execFileSync('npx', ['--yes', 'supabase', 'secrets', 'set', `APP_URL=${url}`], {
    cwd: root,
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: cfg.SUPABASE_ACCESS_TOKEN },
    stdio: 'inherit',
  });
} catch {
  console.error('\nThe Supabase CLI rejected that. Check the project is still linked: npm run setup');
  process.exit(1);
}

console.log(`
APP_URL is set. Notifications will now deep-link to ${url}.

Next: open that URL in Safari on your iPhone, Share -> Add to Home Screen,
then open it from the home screen and enable push in Settings.`);

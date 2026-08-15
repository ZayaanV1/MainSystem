#!/usr/bin/env node
/**
 * Sends a test notification through the real pipeline.
 *
 *   npm run test:notify
 *
 * Signs in as the app's user and calls the dispatch function the same way the
 * "send test digest now" button will, so this exercises the JWT path, the
 * channel lookup, the delivery layer and the delivery log — everything the
 * 07:00 digest uses except the scheduler itself.
 *
 * If a message lands on the phone, Phase 0's hard requirement is met.
 */

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

const setup = parseEnv(join(root, '.env.setup'));
const local = parseEnv(join(root, '.env.local'));

const URL_BASE = local.VITE_SUPABASE_URL;
const ANON = local.VITE_SUPABASE_ANON_KEY;

if (!URL_BASE || !ANON) {
  console.error('No .env.local found. Run `npm run setup` first.');
  process.exit(1);
}
if (!setup.APP_EMAIL || !setup.APP_PASSWORD) {
  console.error('No credentials in .env.setup. Run `npm run setup` first.');
  process.exit(1);
}

const signIn = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: setup.APP_EMAIL, password: setup.APP_PASSWORD }),
}).then((r) => r.json());

if (!signIn.access_token) {
  console.error(`Could not sign in: ${signIn.error_description ?? JSON.stringify(signIn)}`);
  process.exit(1);
}

console.log(`Signed in as ${setup.APP_EMAIL}.`);
console.log('Calling dispatch...\n');

const res = await fetch(`${URL_BASE}/functions/v1/dispatch`, {
  method: 'POST',
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${signIn.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({}),
});

const body = await res.text();
console.log(body);

if (res.ok) {
  console.log('\nDispatch reported success. Check your phone.');
  console.log('If nothing arrives, the delivery log in the database has the reason.');
} else {
  console.error(`\nDispatch returned HTTP ${res.status}. The body above says why.`);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * Read or set the medication dose count.
 *
 *   npm run doses          # show what's left
 *   npm run doses 30       # set the count after a refill
 *
 * A stopgap until the checklist item editor exists. Worth having anyway: the
 * dose count is the one number in this app that being wrong about has
 * consequences outside it, and a way to correct it that does not depend on the
 * UI being finished is cheap insurance.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const parse = (f) => {
  if (!existsSync(f)) return {};
  const o = {};
  for (const raw of readFileSync(f, 'utf8').split('\n')) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    o[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return o;
};

const setup = parse(join(root, '.env.setup'));
const local = parse(join(root, '.env.local'));

if (!local.VITE_SUPABASE_URL || !setup.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Not configured. Run `npm run setup` first.');
  process.exit(1);
}

const H = {
  apikey: setup.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${setup.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const rest = async (path, init = {}) => {
  const r = await fetch(`${local.VITE_SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: { ...H, ...init.headers },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

const tracked = await rest(
  '/checklist_items?select=id,title,doses_remaining,doses_per_completion,refill_warning_days&tracks_doses=eq.true',
);

if (!tracked.length) {
  console.error('No checklist item is tracking doses.');
  process.exit(1);
}

const arg = process.argv[2];

if (arg === undefined) {
  for (const m of tracked) {
    const days = Math.floor((m.doses_remaining ?? 0) / Math.max(1, m.doses_per_completion));
    console.log(
      `${m.title}: ${m.doses_remaining ?? 0} left (${days} ${days === 1 ? 'day' : 'days'}), warns at ${m.refill_warning_days} days`,
    );
  }
  console.log('\nTo set it after a refill:  npm run doses 30');
  process.exit(0);
}

const count = Number(arg);
if (!Number.isInteger(count) || count < 0) {
  console.error(`"${arg}" is not a whole number of doses.`);
  process.exit(1);
}

const [item] = tracked;
await rest(`/checklist_items?id=eq.${item.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ doses_remaining: count }),
});

const days = Math.floor(count / Math.max(1, item.doses_per_completion));
console.log(
  `${item.title}: set to ${count} (${days} ${days === 1 ? 'day' : 'days'}). Warns at ${item.refill_warning_days} days left.`,
);

import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the real migrations against real Postgres (compiled to WASM) so that a
 * typo, a bad constraint, or a policy that does not do what it reads like
 * cannot reach the production database.
 *
 * Two things are stubbed because they belong to the hosted platform rather
 * than to our schema:
 *
 *   - pg_cron / pg_net, which are Supabase-provided extensions. Their absence
 *     does not affect whether our DDL is correct.
 *   - the `auth` schema. We create a minimal stand-in with the same shape
 *     Supabase exposes, so foreign keys and auth.uid() policies compile and
 *     can actually be exercised.
 *
 * Everything else — every table, constraint, index, trigger and RLS policy —
 * is the genuine article.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

const AUTH_STUB = `
  create schema if not exists auth;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique
  );

  -- Supabase reads the current user from a request-scoped GUC. Same mechanism,
  -- so policies below are exercised exactly as they will be in production.
  create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create role authenticated;
`;

/** Strip only the hosted-platform extensions; leave all of our DDL intact. */
function loadMigrations(): { name: string; sql: string }[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name), 'utf8').replace(
        /create extension if not exists (pg_cron|pg_net);/g,
        '-- (extension stubbed in test)',
      ),
    }));
}

let db: PGlite;
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

/**
 * Run a statement as a given authenticated user, with RLS enforced.
 *
 * Each call is its own transaction, rolled back unconditionally. PGlite runs on
 * a single connection, so one statement rejected by a policy would otherwise
 * poison every test that followed it.
 *
 * Pass an empty uid to act as an unauthenticated caller.
 */
async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec('begin');
  try {
    await db.exec(`set local role authenticated;`);
    await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', true);`);
    return await fn();
  } finally {
    await db.exec('rollback');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(AUTH_STUB);

  for (const { name, sql } of loadMigrations()) {
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`migration ${name} failed:\n${(e as Error).message}`);
    }
  }

  // Supabase grants table privileges to `authenticated` automatically via
  // default privileges on the public schema. Reproduce that here, because it
  // is what makes RLS — rather than a missing GRANT — the thing that denies.
  // Without it these tests would pass for the wrong reason.
  await db.exec(`
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `);

  await db.exec(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'a@example.com'),
      ('${USER_B}', 'b@example.com');
  `);
}, 60_000);

describe('migrations apply', () => {
  it('creates every Phase 0 table', async () => {
    const res = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([
      'app_settings',
      'delivery_log',
      'notification_channels',
      'push_subscriptions',
    ]);
  });

  it('contains no Phase 1 feature tables — the push proof comes first', async () => {
    const res = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public'`,
    );
    const names = res.rows.map((r) => r.tablename);
    for (const leaked of ['assignments', 'events', 'courses', 'checklist_items']) {
      expect(names).not.toContain(leaked);
    }
  });
});

describe('row level security', () => {
  it('is enabled on every table without exception', async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    );
    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      expect(row.relrowsecurity, `${row.relname} has RLS disabled`).toBe(true);
    }
  });

  it('gives every table at least one policy', async () => {
    const res = await db.query<{ tablename: string; n: number }>(
      `select tablename, count(*)::int as n from pg_policies
        where schemaname = 'public' group by tablename`,
    );
    const byTable = Object.fromEntries(res.rows.map((r) => [r.tablename, r.n]));
    for (const t of ['app_settings', 'notification_channels', 'push_subscriptions', 'delivery_log']) {
      expect(byTable[t], `${t} has no RLS policy`).toBeGreaterThan(0);
    }
  });
});

describe('data is not readable across users', () => {
  beforeAll(async () => {
    // Written as the table owner, bypassing RLS, to set up cross-user fixtures.
    await db.exec(`
      insert into public.notification_channels (user_id, kind, config, priority)
      values ('${USER_A}', 'telegram', '{"chat_id":"aaa"}', 10),
             ('${USER_B}', 'telegram', '{"chat_id":"bbb"}', 10);

      insert into public.delivery_log (user_id, kind, channel, local_day, status)
      values ('${USER_A}', 'digest', 'telegram', '2026-08-15', 'sent'),
             ('${USER_B}', 'digest', 'telegram', '2026-08-15', 'sent');
    `);
  });

  it('shows a user only their own channels', async () => {
    const res = await asUser(USER_A, () =>
      db.query<{ config: { chat_id: string } }>(`select config from public.notification_channels`),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].config.chat_id).toBe('aaa');
  });

  it('shows a user only their own delivery log', async () => {
    const res = await asUser(USER_B, () =>
      db.query<{ user_id: string }>(`select user_id from public.delivery_log`),
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].user_id).toBe(USER_B);
  });

  it('returns nothing at all to an unauthenticated caller', async () => {
    const res = await asUser('', () => db.query(`select * from public.notification_channels`));
    expect(res.rows).toHaveLength(0);
  });

  it('refuses to let a user write a row owned by someone else', async () => {
    await expect(
      asUser(USER_A, () =>
        db.query(
          `insert into public.notification_channels (user_id, kind) values ('${USER_B}', 'telegram')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('does not let the client forge a delivery log entry', async () => {
    // Only SELECT is granted by policy. Writes come from the edge function
    // under the service role, so notification history cannot be fabricated
    // from the app — which is what makes it trustworthy as a health signal.
    await expect(
      asUser(USER_A, () =>
        db.query(
          `insert into public.delivery_log (user_id, kind, local_day, status)
           values ('${USER_A}', 'digest', '2026-08-16', 'sent')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('digest idempotency — the scheduler is allowed to be dumb', () => {
  it('permits only one sent digest per local day', async () => {
    await db.exec(`
      insert into public.delivery_log (user_id, kind, channel, local_day, status)
      values ('${USER_A}', 'digest', 'telegram', '2026-09-01', 'sent');
    `);

    // The scheduler fires every 15 minutes and will re-enter the window. The
    // unique index is what stops that becoming four identical 07:00 pushes.
    await expect(
      db.exec(`
        insert into public.delivery_log (user_id, kind, channel, local_day, status)
        values ('${USER_A}', 'digest', 'telegram', '2026-09-01', 'sent');
      `),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('still records repeated failures, so a broken pipeline is visible', async () => {
    // Failures must NOT be deduplicated — four failed attempts is the signal.
    await db.exec(`
      insert into public.delivery_log (user_id, kind, channel, local_day, status, error)
      values ('${USER_A}', 'digest', 'telegram', '2026-09-02', 'failed', 'network');
    `);
    await db.exec(`
      insert into public.delivery_log (user_id, kind, channel, local_day, status, error)
      values ('${USER_A}', 'digest', 'telegram', '2026-09-02', 'failed', 'network');
    `);

    const res = await db.query<{ n: number }>(
      `select count(*)::int as n from public.delivery_log
        where local_day = '2026-09-02' and status = 'failed'`,
    );
    expect(res.rows[0].n).toBe(2);
  });

  it('allows a test send on a day that already has a digest', async () => {
    // "Send test digest now" must work even after the morning digest landed.
    await db.exec(`
      insert into public.delivery_log (user_id, kind, channel, local_day, status)
      values ('${USER_A}', 'test', 'telegram', '2026-09-01', 'sent');
    `);
    const res = await db.query<{ n: number }>(
      `select count(*)::int as n from public.delivery_log where local_day = '2026-09-01'`,
    );
    expect(res.rows[0].n).toBe(2);
  });
});

describe('settings bootstrap and constraints', () => {
  it('creates a settings row automatically when a user signs up', async () => {
    const res = await db.query<{ n: number }>(
      `select count(*)::int as n from public.app_settings where user_id = '${USER_A}'`,
    );
    expect(res.rows[0].n).toBe(1);
  });

  it('seeds the digest at 07:00 America/Toronto', async () => {
    const res = await db.query<{
      timezone: string;
      digest_hour: number;
      digest_minute: number;
      assignment_window_days: number;
      event_window_days: number;
    }>(`select timezone, digest_hour, digest_minute, assignment_window_days, event_window_days
          from public.app_settings where user_id = '${USER_A}'`);
    expect(res.rows[0]).toMatchObject({
      timezone: 'America/Toronto',
      digest_hour: 7,
      digest_minute: 0,
      assignment_window_days: 7,
      event_window_days: 14,
    });
  });

  it('rejects an impossible digest hour', async () => {
    await expect(
      db.exec(`update public.app_settings set digest_hour = 24 where user_id = '${USER_A}'`),
    ).rejects.toThrow(/check constraint/i);
  });

  it('cascades cleanly when a user is deleted, so export-and-leave really works', async () => {
    await db.exec(`insert into auth.users (id, email) values
      ('33333333-3333-3333-3333-333333333333', 'c@example.com')`);
    await db.exec(`insert into public.notification_channels (user_id, kind)
      values ('33333333-3333-3333-3333-333333333333', 'telegram')`);

    await db.exec(`delete from auth.users where id = '33333333-3333-3333-3333-333333333333'`);

    const res = await db.query<{ n: number }>(
      `select count(*)::int as n from public.notification_channels
        where user_id = '33333333-3333-3333-3333-333333333333'`,
    );
    expect(res.rows[0].n).toBe(0);
  });
});

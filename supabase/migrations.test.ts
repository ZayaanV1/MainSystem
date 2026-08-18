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

/**
 * Stand-ins for the pieces Supabase provides rather than our schema: the auth
 * schema, Vault, pg_cron and pg_net. Same names and signatures, so our DDL
 * compiles and runs against them exactly as written.
 *
 * cron.schedule records its calls in a table, which lets the tests assert that
 * the job is scheduled once with the expected expression — the kind of thing
 * that is otherwise only discovered by receiving four identical notifications.
 */
const PLATFORM_STUB = `
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
  create role anon;
  create role service_role;

  -- Vault stores secrets encrypted and exposes them through a decrypting view.
  -- Reproduced here as a table pair with the same names and function
  -- signatures, so setup_dispatch runs against it unmodified.
  create schema if not exists vault;
  create table vault.secrets (
    id uuid primary key default gen_random_uuid(),
    name text unique,
    secret text
  );
  create view vault.decrypted_secrets as
    select id, name, secret as decrypted_secret from vault.secrets;

  create function vault.create_secret(new_secret text, new_name text default null,
                                      new_description text default '')
  returns uuid language plpgsql as $fn$
  declare v_id uuid;
  begin
    insert into vault.secrets (name, secret) values (new_name, new_secret) returning id into v_id;
    return v_id;
  end;
  $fn$;

  create function vault.update_secret(secret_id uuid, new_secret text default null,
                                      new_name text default null, new_description text default null)
  returns void language plpgsql as $fn$
  begin
    update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id;
  end;
  $fn$;

  create schema if not exists cron;
  create table cron.jobs (jobname text primary key, schedule text, command text);

  -- Parameters are prefixed to avoid shadowing the column names they are
  -- compared against. Real pg_cron is a C function and has no such problem.
  create function cron.schedule(p_jobname text, p_schedule text, p_command text)
  returns bigint language plpgsql as $fn$
  begin
    insert into cron.jobs (jobname, schedule, command)
    values (p_jobname, p_schedule, p_command)
      on conflict (jobname) do update set schedule = excluded.schedule,
                                          command  = excluded.command;
    return 1;
  end;
  $fn$;

  create function cron.unschedule(p_jobname text)
  returns boolean language plpgsql as $fn$
  begin
    if not exists (select 1 from cron.jobs where jobname = p_jobname) then
      raise exception 'could not find valid entry for job %', p_jobname;
    end if;
    delete from cron.jobs where jobname = p_jobname;
    return true;
  end;
  $fn$;

  create schema if not exists net;
  create table net.calls (id bigserial primary key, url text, headers jsonb, body jsonb);

  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                                headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $fn$
  declare v_id bigint;
  begin
    insert into net.calls (url, headers, body) values (url, headers, body) returning id into v_id;
    return v_id;
  end;
  $fn$;
`;

/** Strip only the hosted-platform extension declarations; leave our DDL intact. */
function loadMigrations(): { name: string; sql: string }[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name), 'utf8')
        .replace(
          /create extension if not exists (pg_cron|pg_net);/g,
          '-- (extension stubbed in test)',
        )
        .replace(
          /create extension if not exists supabase_vault with schema vault;/g,
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
  await db.exec(PLATFORM_STUB);

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
  it('creates every table, Phase 0 infrastructure and Phase 1 content', async () => {
    const res = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([
      'app_settings',
      'assignments',
      'checklist_completions',
      'checklist_items',
      'courses',
      'delivery_log',
      'events',
      'inbox_items',
      'notification_channels',
      'push_subscriptions',
      'subtasks',
    ]);
  });

  it('stores no streak or missed-day counters anywhere', async () => {
    // A structural guard on rule 3. CLAUDE.md records that no-streak-shaming
    // "has been violated by well-meaning refactors before", and the cheapest
    // way for that to happen is a column quietly appearing to cache a count.
    // Missed days are the absence of a row, never a number.
    // Anchored to word boundaries: an unanchored 'missed' also matches
    // `dismissed_at`, which is a legitimate inbox column.
    const res = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and (column_name ~ '(^|_)streak(_|$)'
               or column_name ~ '(^|_)missed(_|$)'
               or column_name ~ '(^|_)consecutive(_|$)'
               or column_name ~ '(^|_)(days|times)_in_a_row(_|$)'
               or column_name ~ '_count$')`,
    );
    expect(res.rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
  });
});

describe('capture friction — almost everything is optional on purpose', () => {
  it('captures an inbox item from nothing but text', async () => {
    await db.exec(
      `insert into public.inbox_items (user_id, body) values ('${USER_A}', 'chem lab report??')`,
    );
    const res = await db.query<{ body: string; source: string }>(
      `select body, source from public.inbox_items where user_id = '${USER_A}'`,
    );
    expect(res.rows[0]).toMatchObject({ body: 'chem lab report??', source: 'app' });
  });

  it('rejects an empty capture, which would be a row that means nothing', async () => {
    await expect(
      db.exec(`insert into public.inbox_items (user_id, body) values ('${USER_A}', '   ')`),
    ).rejects.toThrow(/check constraint/i);
  });

  it('creates an assignment with only a title — no course, no due date', async () => {
    await db.exec(`insert into public.assignments (user_id, title) values ('${USER_A}', 'email prof')`);
    const res = await db.query<{ title: string; status: string; due_at: string | null }>(
      `select title, status, due_at from public.assignments where title = 'email prof'`,
    );
    expect(res.rows[0]).toMatchObject({ status: 'todo', due_at: null });
  });

  it('keeps an assignment when its course is deleted, rather than deleting the work', async () => {
    await db.exec(`insert into public.courses (id, user_id, name)
      values ('aaaaaaaa-0000-0000-0000-000000000001', '${USER_A}', 'Chem 101')`);
    await db.exec(`insert into public.assignments (id, user_id, course_id, title)
      values ('bbbbbbbb-0000-0000-0000-000000000001', '${USER_A}',
              'aaaaaaaa-0000-0000-0000-000000000001', 'Lab report')`);

    await db.exec(`delete from public.courses where id = 'aaaaaaaa-0000-0000-0000-000000000001'`);

    const res = await db.query<{ course_id: string | null }>(
      `select course_id from public.assignments where id = 'bbbbbbbb-0000-0000-0000-000000000001'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].course_id).toBeNull();
  });
});

describe('checklist recurrence', () => {
  it('accepts a plain daily item', async () => {
    await db.exec(
      `insert into public.checklist_items (user_id, title) values ('${USER_A}', 'Creatine')`,
    );
    const res = await db.query(`select 1 from public.checklist_items where title = 'Creatine'`);
    expect(res.rows).toHaveLength(1);
  });

  it('rejects a weekdays item with no weekdays, which would never appear', async () => {
    await expect(
      db.exec(`insert into public.checklist_items (user_id, title, recurrence)
               values ('${USER_A}', 'Gym', 'weekdays')`),
    ).rejects.toThrow(/recurrence_is_complete/i);
  });

  it('rejects an interval item with no interval', async () => {
    await expect(
      db.exec(`insert into public.checklist_items (user_id, title, recurrence)
               values ('${USER_A}', 'Sheets', 'interval')`),
    ).rejects.toThrow(/recurrence_is_complete/i);
  });

  it('accepts a fully specified interval item', async () => {
    await db.exec(`insert into public.checklist_items
      (user_id, title, recurrence, interval_days, anchor_day)
      values ('${USER_A}', 'Change sheets', 'interval', 14, '2026-08-17')`);
    const res = await db.query(`select 1 from public.checklist_items where title = 'Change sheets'`);
    expect(res.rows).toHaveLength(1);
  });
});

describe('medication dose counting — the number it is worst to get wrong', () => {
  const MED = 'cccccccc-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await db.exec(`insert into public.checklist_items
      (id, user_id, title, tracks_doses, doses_remaining, doses_per_completion)
      values ('${MED}', '${USER_A}', 'Medication', true, 30, 1)`);
  });

  const doses = async () => {
    const r = await db.query<{ doses_remaining: number }>(
      `select doses_remaining from public.checklist_items where id = '${MED}'`,
    );
    return r.rows[0].doses_remaining;
  };

  it('counts down when the box is checked', async () => {
    await db.exec(`insert into public.checklist_completions (user_id, item_id, local_day)
                   values ('${USER_A}', '${MED}', '2026-08-17')`);
    expect(await doses()).toBe(29);
  });

  it('gives the dose back when the box is unchecked', async () => {
    // Undo is a tap in the same place, so it happens by accident constantly.
    // Losing a dose each time would make the counter useless within a week.
    await db.exec(
      `delete from public.checklist_completions where item_id = '${MED}' and local_day = '2026-08-17'`,
    );
    expect(await doses()).toBe(30);
  });

  it('counts down by the configured dose size, not by one', async () => {
    await db.exec(
      `update public.checklist_items set doses_per_completion = 2 where id = '${MED}'`,
    );
    await db.exec(`insert into public.checklist_completions (user_id, item_id, local_day)
                   values ('${USER_A}', '${MED}', '2026-08-18')`);
    expect(await doses()).toBe(28);
  });

  it('never goes negative', async () => {
    await db.exec(`update public.checklist_items set doses_remaining = 1 where id = '${MED}'`);
    await db.exec(`insert into public.checklist_completions (user_id, item_id, local_day)
                   values ('${USER_A}', '${MED}', '2026-08-19')`);
    expect(await doses()).toBe(0);
  });

  it('does not invent a dose when checked and unchecked at zero', async () => {
    // The state on 17 Aug 2026: none left, refill tomorrow. Tapping the row by
    // accident and untapping it must not conjure a pill that does not exist —
    // undo has to return exactly what was taken, which at zero is nothing.
    await db.exec(`update public.checklist_items set doses_remaining = 0 where id = '${MED}'`);

    await db.exec(`insert into public.checklist_completions (user_id, item_id, local_day)
                   values ('${USER_A}', '${MED}', '2026-08-20')`);
    expect(await doses()).toBe(0);

    await db.exec(
      `delete from public.checklist_completions where item_id = '${MED}' and local_day = '2026-08-20'`,
    );
    expect(await doses()).toBe(0);
  });

  it('returns only the partial amount actually deducted', async () => {
    // One dose left, two taken per completion: the deduction is capped at one,
    // so undo must return one, not two.
    await db.exec(
      `update public.checklist_items set doses_remaining = 1, doses_per_completion = 2 where id = '${MED}'`,
    );

    await db.exec(`insert into public.checklist_completions (user_id, item_id, local_day)
                   values ('${USER_A}', '${MED}', '2026-08-21')`);
    expect(await doses()).toBe(0);

    await db.exec(
      `delete from public.checklist_completions where item_id = '${MED}' and local_day = '2026-08-21'`,
    );
    expect(await doses()).toBe(1);
  });

  it('leaves non-medication items alone', async () => {
    await db.exec(`insert into public.checklist_items
      (id, user_id, title) values ('dddddddd-0000-0000-0000-000000000001', '${USER_A}', 'Walk')`);
    await db.exec(`insert into public.checklist_completions (user_id, item_id, local_day)
      values ('${USER_A}', 'dddddddd-0000-0000-0000-000000000001', '2026-08-17')`);

    const r = await db.query<{ doses_remaining: number | null }>(
      `select doses_remaining from public.checklist_items
        where id = 'dddddddd-0000-0000-0000-000000000001'`,
    );
    expect(r.rows[0].doses_remaining).toBeNull();
  });
});

describe('checklist completions are per local day', () => {
  const ITEM = 'eeeeeeee-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await db.exec(`insert into public.checklist_items (id, user_id, title)
                   values ('${ITEM}', '${USER_A}', 'Read')`);
  });

  it('allows one completion per item per day', async () => {
    await db.exec(`insert into public.checklist_completions (user_id, item_id, local_day)
                   values ('${USER_A}', '${ITEM}', '2026-08-17')`);
    await expect(
      db.exec(`insert into public.checklist_completions (user_id, item_id, local_day)
               values ('${USER_A}', '${ITEM}', '2026-08-17')`),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('back-fills an earlier day as an ordinary insert', async () => {
    // Missed days must be trivially recoverable. This is the whole mechanism:
    // a different string, no special case, no penalty.
    await db.exec(`insert into public.checklist_completions
      (user_id, item_id, local_day, backfilled)
      values ('${USER_A}', '${ITEM}', '2026-08-14', true)`);

    const r = await db.query<{ local_day: string }>(
      `select local_day from public.checklist_completions
        where item_id = '${ITEM}' order by local_day`,
    );
    expect(r.rows.map((x) => x.local_day)).toEqual(['2026-08-14', '2026-08-17']);
  });

  it('refuses a malformed day key', async () => {
    await expect(
      db.exec(`insert into public.checklist_completions (user_id, item_id, local_day)
               values ('${USER_A}', '${ITEM}', 'yesterday')`),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('Phase 1 tables are private too', () => {
  it('enables RLS on every content table', async () => {
    for (const t of [
      'courses',
      'inbox_items',
      'assignments',
      'subtasks',
      'events',
      'checklist_items',
      'checklist_completions',
    ]) {
      const r = await db.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where relname = '${t}'`,
      );
      expect(r.rows[0].relrowsecurity, `${t} has RLS disabled`).toBe(true);
    }
  });

  it('does not show one user another user’s assignments', async () => {
    await db.exec(
      `insert into public.assignments (user_id, title) values ('${USER_B}', 'B private essay')`,
    );

    const res = await asUser(USER_A, () =>
      db.query<{ title: string }>(`select title from public.assignments`),
    );
    expect(res.rows.map((r) => r.title)).not.toContain('B private essay');
  });

  it('does not show one user another user’s captured thoughts', async () => {
    await db.exec(
      `insert into public.inbox_items (user_id, body) values ('${USER_B}', 'B private thought')`,
    );

    const res = await asUser(USER_A, () =>
      db.query<{ body: string }>(`select body from public.inbox_items`),
    );
    expect(res.rows.map((r) => r.body)).not.toContain('B private thought');
  });
});

describe('the scheduled job', () => {
  it('is scheduled exactly once, every 15 minutes', async () => {
    const res = await db.query<{ jobname: string; schedule: string; command: string }>(
      `select jobname, schedule, command from cron.jobs`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].jobname).toBe('life-planner-dispatch');
    expect(res.rows[0].schedule).toBe('*/15 * * * *');
    expect(res.rows[0].command).toContain('dispatch_tick');
  });

  it('stays at one job when the migration is applied again', async () => {
    // Re-running migrations must not accumulate duplicate schedules. Four
    // identical 07:00 notifications is a bug you only discover on a phone.
    for (const { sql } of loadMigrations().filter((m) => m.name.startsWith('0002'))) {
      await db.exec(sql);
    }
    const res = await db.query(`select jobname from cron.jobs`);
    expect(res.rows).toHaveLength(1);
  });

  it('does nothing quietly when the secrets are not configured yet', async () => {
    // This is the real state between running migrations and running setup.
    // It must no-op rather than raise every 15 minutes forever.
    await db.exec(`delete from vault.secrets`);
    await db.exec(`delete from net.calls`);

    await expect(db.exec(`select private.dispatch_tick()`)).resolves.toBeTruthy();

    const res = await db.query(`select * from net.calls`);
    expect(res.rows).toHaveLength(0);
  });

  it('posts to the dispatch URL with the cron secret once configured', async () => {
    await db.exec(
      `select public.setup_dispatch('https://ref.supabase.co/functions/v1/dispatch', 'super-secret-value')`,
    );
    await db.exec(`delete from net.calls`);

    await db.exec(`select private.dispatch_tick()`);

    const res = await db.query<{ url: string; headers: Record<string, string> }>(
      `select url, headers from net.calls`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].url).toBe('https://ref.supabase.co/functions/v1/dispatch');
    expect(res.rows[0].headers['x-cron-secret']).toBe('super-secret-value');
  });

  it('is safe to reconfigure — setup can be re-run without duplicating secrets', async () => {
    await db.exec(`select public.setup_dispatch('https://ref.supabase.co/x', 'rotated-secret')`);
    const res = await db.query<{ n: number }>(
      `select count(*)::int as n from vault.secrets where name = 'cron_secret'`,
    );
    expect(res.rows[0].n).toBe(1);

    const secret = await db.query<{ decrypted_secret: string }>(
      `select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'`,
    );
    expect(secret.rows[0].decrypted_secret).toBe('rotated-secret');
  });

  it('does not expose the tick function to the client roles', async () => {
    for (const role of ['authenticated', 'anon']) {
      const res = await db.query<{ ok: boolean }>(
        `select has_function_privilege('${role}', 'private.dispatch_tick()', 'execute') as ok`,
      );
      expect(res.rows[0].ok, `${role} can execute dispatch_tick`).toBe(false);
    }
  });

  it('does not let the browser rewrite where the scheduler posts', async () => {
    // setup_dispatch is service_role only. If authenticated could call it, the
    // client could redirect every future digest to an endpoint it controls.
    for (const role of ['authenticated', 'anon']) {
      const res = await db.query<{ ok: boolean }>(
        `select has_function_privilege('${role}', 'public.setup_dispatch(text,text)', 'execute') as ok`,
      );
      expect(res.rows[0].ok, `${role} can execute setup_dispatch`).toBe(false);
    }

    const svc = await db.query<{ ok: boolean }>(
      `select has_function_privilege('service_role', 'public.setup_dispatch(text,text)', 'execute') as ok`,
    );
    expect(svc.rows[0].ok).toBe(true);
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

describe('courses cannot be duplicated', () => {
  const U = '44444444-4444-4444-4444-000000000001';

  beforeAll(async () => {
    await db.exec(`insert into auth.users (id, email) values ('${U}', 'courses@example.com')`);
    await db.exec(
      `insert into public.courses (user_id, name, code) values ('${U}', 'Organic Chemistry', 'CHEM 233')`,
    );
  });

  it('rejects the same code twice', async () => {
    // A double-tapped "Add course" used to produce two, and from then on every
    // filter chip and syllabus match silently referred to whichever was found
    // first.
    await expect(
      db.exec(
        `insert into public.courses (user_id, name, code) values ('${U}', 'Orgo', 'CHEM 233')`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('treats codes case-insensitively', async () => {
    // "chem 233" and "CHEM 233" are the same course, and being told otherwise
    // by your own planner is absurd.
    await expect(
      db.exec(
        `insert into public.courses (user_id, name, code) values ('${U}', 'Orgo', 'chem 233')`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('ignores surrounding whitespace', async () => {
    await expect(
      db.exec(
        `insert into public.courses (user_id, name, code) values ('${U}', 'Orgo', '  CHEM 233 ')`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('rejects the same name twice, even without a code', async () => {
    await expect(
      db.exec(`insert into public.courses (user_id, name) values ('${U}', 'organic chemistry')`),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('allows a different course', async () => {
    await db.exec(
      `insert into public.courses (user_id, name, code) values ('${U}', 'Linear Algebra', 'MATH 133')`,
    );
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.courses where user_id = '${U}'`,
    );
    expect(r.rows[0].n).toBe(2);
  });

  it('allows two courses that both have no code', async () => {
    await db.exec(`insert into public.courses (user_id, name) values ('${U}', 'Yoga')`);
    await db.exec(`insert into public.courses (user_id, name) values ('${U}', 'Reading group')`);
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.courses where user_id = '${U}' and code is null`,
    );
    expect(r.rows[0].n).toBe(2);
  });

  it('lets an archived course free its code for a retake', async () => {
    await db.exec(`update public.courses set archived = true where user_id = '${U}'`);
    await db.exec(
      `insert into public.courses (user_id, name, code) values ('${U}', 'Organic Chemistry', 'CHEM 233')`,
    );
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.courses
        where user_id = '${U}' and code = 'CHEM 233'`,
    );
    expect(r.rows[0].n).toBe(2);
  });

  it('does not collide across users', async () => {
    await db.exec(
      `insert into public.courses (user_id, name, code) values ('${USER_B}', 'Organic Chemistry', 'CHEM 233')`,
    );
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.courses where user_id = '${USER_B}'`,
    );
    expect(r.rows[0].n).toBe(1);
  });
});

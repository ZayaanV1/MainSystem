import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The scheduler's entry point, run for real.
 *
 * dispatch is public by construction (verify_jwt is off and pg_cron cannot
 * present a login), so everything rests on its own checks: the shared secret,
 * and the rule for what to do when a digest keeps failing. Both live in the
 * handler, which is where nothing was tested.
 */

interface Insert {
  table: string;
  row: Record<string, unknown>;
}

const inserts: Insert[] = [];
const fetches: { url: string; body: Record<string, unknown> }[] = [];
let failedToday = 0;
let alertedToday = 0;

const NOW = new Date();
const settingsRow = {
  user_id: 'user-1',
  timezone: 'UTC',
  digest_hour: NOW.getUTCHours(),
  digest_minute: NOW.getUTCMinutes(),
  digest_enabled: true,
  assignment_window_days: 7,
  event_window_days: 14,
  weekly_review_enabled: false,
  weekly_review_weekday: 0,
};

/** Answers a query by table and by the status filter it carries, however it is chained. */
function chain(table: string): unknown {
  const filters: Record<string, unknown> = {};
  let like: string | null = null;
  const result = () => {
    if (table === 'app_settings') return { data: [settingsRow], error: null };
    if (table === 'delivery_log') {
      const status = filters.status;
      if (status === 'failed') return { data: null, count: failedToday, error: null };
      if (status === 'skipped' && like?.startsWith('alerted')) return { data: null, count: alertedToday, error: null };
      return { data: null, count: 0, error: null };
    }
    return { data: null, count: 0, error: null };
  };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, key) => {
      if (key === 'then') return (resolve: (v: unknown) => void) => resolve(result());
      if (key === 'eq') return (col: string, val: unknown) => ((filters[col] = val), p);
      if (key === 'like') return (_col: string, pattern: string) => ((like = pattern), p);
      if (key === 'insert') return (row: Record<string, unknown>) => (inserts.push({ table, row }), p);
      return () => p;
    },
    apply: () => p,
  });
  return p;
}

const fakeAdmin = {
  auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) },
  from: (table: string) => chain(table),
  rpc: async () => ({ data: null, error: null }),
};

vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: () => fakeAdmin }));

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const env: Record<string, string> = {
    APP_URL: 'https://planner.example.app',
    SUPABASE_URL: 'https://x.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    CRON_SECRET: 'cron-secret-value',
    ALERT_TELEGRAM_CHAT_ID: '555',
    TELEGRAM_BOT_TOKEN: 'bot-token',
  };
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] }, serve: (h: (req: Request) => Promise<Response>) => (handler = h) });
  await import('../supabase/functions/dispatch/index.ts');
});

beforeEach(() => {
  inserts.length = 0;
  fetches.length = 0;
  failedToday = 0;
  alertedToday = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    fetches.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response('{}', { status: 200 });
  });
});

const tick = (headers: Record<string, string>) =>
  handler(new Request('https://x.test/functions/v1/dispatch', { method: 'POST', headers, body: '{}' }));

const alertsSent = () => fetches.filter((f) => f.url.includes('api.telegram.org') && f.body.chat_id === '555');

describe('who may run the scheduler', () => {
  it('refuses a call with no secret and no login', async () => {
    expect((await tick({})).status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it('refuses a wrong secret, including one of the right length', async () => {
    expect((await tick({ 'x-cron-secret': 'cron-secret-valuf' })).status).toBe(401);
    expect((await tick({ 'x-cron-secret': 'x' })).status).toBe(401);
  });

  it('refuses a login that the auth service does not know', async () => {
    expect((await tick({ Authorization: 'Bearer not-a-real-token' })).status).toBe(401);
  });
});

describe('a digest that keeps failing', () => {
  it('says nothing while it is only failing a little', async () => {
    failedToday = 4;
    const res = await tick({ 'x-cron-secret': 'cron-secret-value' });
    expect(res.status).toBe(200);
    expect(alertsSent()).toHaveLength(0);
    expect(inserts.filter((i) => i.row.status === 'skipped' && String(i.row.error).startsWith('alerted'))).toHaveLength(0);
  });

  it('tells the operator once after six failures, and records that it did', async () => {
    failedToday = 6;
    await tick({ 'x-cron-secret': 'cron-secret-value' });
    expect(alertsSent()).toHaveLength(1);
    expect(String(alertsSent()[0].body.text)).toMatch(/failing to deliver/);
    // Names the account by a short id and carries no titles.
    expect(String(alertsSent()[0].body.text)).toContain('user-1');
    expect(inserts.some((i) => i.table === 'delivery_log' && String(i.row.error).startsWith('alerted after 6'))).toBe(true);
  });

  it('does not tell them again on the next tick', async () => {
    failedToday = 8;
    alertedToday = 1;
    await tick({ 'x-cron-secret': 'cron-secret-value' });
    expect(alertsSent()).toHaveLength(0);
  });

  it('keeps trying to deliver after alerting: a short outage must not cost the digest', async () => {
    failedToday = 6;
    await tick({ 'x-cron-secret': 'cron-secret-value' });
    // deliver() ran: with no channel configured it records a skip for the digest itself.
    expect(inserts.some((i) => i.table === 'delivery_log' && i.row.kind === 'digest' && String(i.row.error).includes('no notification channel'))).toBe(true);
  });
});

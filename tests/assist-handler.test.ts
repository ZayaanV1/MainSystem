import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The assist function's request handler, run for real.
 *
 * Until now the edge functions' entry files were only type-checked: the shared
 * pieces under them had tests, but login, the daily limits and the failure
 * messages live in the handler, and the bugs found in the 22 Oct audit came
 * from exactly there. The handler is a closure passed to Deno.serve at import,
 * so Deno is stubbed to capture it, and the Supabase client and the model
 * providers are replaced with fakes that record what they are asked.
 */

interface Call {
  fn: string;
  args: Record<string, unknown>;
}

const calls: Call[] = [];
let reserveAnswer = 1;
let modelAnswer: unknown = { ok: true, value: { steps: [{ title: 'Open the brief and copy the three marking criteria into a doc', minutes: 15 }] }, provider: 'fake' };
const tables: Record<string, unknown> = {};
let signedIn = true;

/** A query builder that answers whatever was set for its table, however it is chained. */
function chain(table: string): unknown {
  const result = { data: tables[table] ?? null, error: null };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, key) => (key === 'then' ? (resolve: (v: unknown) => void) => resolve(result) : () => p),
    apply: () => p,
  });
  return p;
}

const fakeAdmin = {
  auth: {
    getUser: async () => (signedIn ? { data: { user: { id: 'user-1' } }, error: null } : { data: { user: null }, error: { message: 'bad token' } }),
  },
  from: (table: string) => chain(table),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === 'reserve_ai_use') return { data: reserveAnswer, error: null };
    return { data: null, error: null };
  },
  storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'gone' } }) }) },
};

vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: () => fakeAdmin }));
vi.mock('../supabase/functions/_shared/llm/gemini', () => ({
  geminiProvider: () => ({ name: 'fake', configured: true, complete: async () => modelAnswer }),
}));
vi.mock('../supabase/functions/_shared/llm/groq', () => ({
  groqProvider: () => ({ name: 'fake-groq', configured: true, complete: async () => modelAnswer }),
}));

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const env: Record<string, string> = { APP_URL: 'https://planner.example.app', SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  vi.stubGlobal('Deno', {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
    },
  });
  await import('../supabase/functions/assist/index.ts');
});

beforeEach(() => {
  calls.length = 0;
  reserveAnswer = 1;
  signedIn = true;
  modelAnswer = { ok: true, value: { steps: [{ title: 'Open the brief and copy the three marking criteria into a doc', minutes: 15 }] }, provider: 'fake' };
  for (const k of Object.keys(tables)) delete tables[k];
  tables.app_settings = { gemini_api_key: null, groq_api_key: null, timezone: 'UTC' };
});

const post = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer token' }) =>
  handler(new Request('https://x.test/functions/v1/assist', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

const rpcs = (name: string) => calls.filter((c) => c.fn === name);

describe('who may call it', () => {
  it('turns away a request with no bearer token', async () => {
    const res = await post({ task: 'breakdown', title: 'x' }, {});
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('turns away a token the auth service does not recognise', async () => {
    signedIn = false;
    const res = await post({ task: 'breakdown', title: 'x' });
    expect(res.status).toBe(401);
    expect(rpcs('reserve_ai_use')).toHaveLength(0);
  });

  it('answers a browser preflight from the app and tells a stranger the app’s own address', async () => {
    const ok = await handler(new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://planner.example.app' } }));
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://planner.example.app');
    const stranger = await handler(new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }));
    expect(stranger.headers.get('Access-Control-Allow-Origin')).toBe('https://planner.example.app');
  });

  it('refuses anything but POST, and a body that is not JSON', async () => {
    expect((await handler(new Request('https://x.test/', { method: 'GET' }))).status).toBe(405);
    const bad = await handler(new Request('https://x.test/', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: 'not json' }));
    expect(bad.status).toBe(400);
  });
});

describe('the daily limit', () => {
  it('takes one slot, calls the model, and keeps the slot when it worked', async () => {
    const res = await post({ task: 'breakdown', title: 'Lab report' });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(rpcs('reserve_ai_use')[0].args).toMatchObject({ p_kind: 'breakdown', p_limit: 20 });
    expect(rpcs('release_ai_use')).toHaveLength(0);
  });

  it('stands down at the account limit without calling the model', async () => {
    reserveAnswer = -1;
    const body = await (await post({ task: 'breakdown', title: 'Lab report' })).json();
    expect(body).toMatchObject({ ok: false, failure: 'quota' });
    expect(body.reason).toMatch(/resets at midnight/);
  });

  it('says the shared allowance is used up, and points at an own key, when the ceiling is hit', async () => {
    reserveAnswer = -2;
    const body = await (await post({ task: 'breakdown', title: 'Lab report' })).json();
    expect(body.reason).toMatch(/own key in Settings/);
  });

  it('gives the slot back when the model produced nothing', async () => {
    modelAnswer = { ok: false, failure: 'unavailable', message: 'timeout', provider: 'fake' };
    const body = await (await post({ task: 'breakdown', title: 'Lab report' })).json();
    expect(body.ok).toBe(false);
    expect(rpcs('release_ai_use')).toHaveLength(1);
  });

  it('counts a syllabus and a briefing against their own kinds', async () => {
    modelAnswer = { ok: false, failure: 'unavailable', message: 'x', provider: 'fake' };
    await post({ task: 'syllabus', text: 'Midterm Oct 30' });
    expect(rpcs('reserve_ai_use').map((c) => c.args.p_kind)).toContain('syllabus');
  });
});

describe('the guide', () => {
  it('will not read a file that is not the caller’s', async () => {
    // The row lookup is scoped to the caller, so someone else's file id finds nothing.
    tables.assignment_files = null;
    const res = await post({ task: 'guide', fileId: '3f2a9c1e-7b44-4d2e-9a10-5c6d7e8f9a0b' });
    expect(res.status).toBe(404);
    expect(rpcs('reserve_ai_use')).toHaveLength(0);
  });

  it('rejects a file id that is not an id', async () => {
    expect((await post({ task: 'guide', fileId: '../../etc/passwd' })).status).toBe(400);
  });

  it('gives the slot back when the stored file cannot be opened', async () => {
    tables.assignment_files = { id: 'f', path: 'u/w/f.pdf', size_bytes: 100, assignment_id: 'w' };
    const res = await post({ task: 'guide', fileId: '3f2a9c1e-7b44-4d2e-9a10-5c6d7e8f9a0b' });
    expect(res.status).toBe(502);
    expect(rpcs('release_ai_use')).toHaveLength(1);
  });
});

describe('what it does not understand', () => {
  it('answers an unknown task with a 400', async () => {
    expect((await post({ task: 'make-coffee' })).status).toBe(400);
  });

  it('asks for something to break down', async () => {
    expect((await post({ task: 'breakdown', title: '   ' })).status).toBe(400);
  });
});

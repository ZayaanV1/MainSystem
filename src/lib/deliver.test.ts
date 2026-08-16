import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deliver } from '../../supabase/functions/_shared/deliver';
import { bytesToB64url } from '../../supabase/functions/_shared/channels/webpush';
import type { OutboundMessage } from '../../supabase/functions/_shared/types';

/**
 * deliver() is the most consequential untested code in the project: it runs
 * unattended at 07:00 with nobody watching, and every one of its failure modes
 * is silent. A channel wrongly retired stops the notifications. A channel never
 * retired hides a dead pipeline behind endless retries. Two channels both
 * succeeding sends the digest twice, which trains you to ignore it.
 *
 * So the fake below is a real PostgREST-shaped chainable builder rather than a
 * stub, and fetch is intercepted at the network boundary so the Telegram and
 * Web Push adapters run their genuine code paths — including the real
 * encryption.
 */

const MSG: OutboundMessage = { title: 'Sat, Aug 15', body: 'Nothing due.' };

/* ------------------------------------------------------------- fake db --- */

interface Row {
  [k: string]: unknown;
}

function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const writes: { table: string; op: string; payload?: Row; match?: Row }[] = [];
  /** Set to a Postgres error code to make the next delivery_log insert fail. */
  let insertErrorCode: string | null = null;

  function matches(row: Row, filters: [string, unknown][]) {
    return filters.every(([col, val]) => row[col] === val);
  }

  function from(table: string) {
    const filters: [string, unknown][] = [];
    let orderBy: string | null = null;

    const read = () => {
      let rows = (tables[table] ?? []).filter((r) => matches(r, filters));
      if (orderBy) {
        rows = [...rows].sort((a, b) => Number(a[orderBy!]) - Number(b[orderBy!]));
      }
      return { data: rows, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return builder;
      },
      is: (c: string, v: unknown) => {
        filters.push([c, v]);
        return builder;
      },
      order: (c: string) => {
        orderBy = c;
        return builder;
      },
      // Thenable, exactly like PostgrestFilterBuilder — which is precisely the
      // detail that broke the Deno typecheck earlier.
      then: (resolve: (v: unknown) => void) => resolve(read()),

      insert: (payload: Row) => {
        writes.push({ table, op: 'insert', payload });
        if (table === 'delivery_log' && insertErrorCode) {
          const code = insertErrorCode;
          insertErrorCode = null;
          return Promise.resolve({ error: { code, message: 'duplicate key' } });
        }
        (tables[table] ??= []).push(payload);
        return Promise.resolve({ error: null });
      },

      update: (payload: Row) => {
        const sub: Record<string, unknown> = {
          eq: (c: string, v: unknown) => {
            filters.push([c, v]);
            return sub;
          },
          then: (resolve: (v: unknown) => void) => {
            for (const row of tables[table] ?? []) {
              if (matches(row, filters)) Object.assign(row, payload);
            }
            writes.push({ table, op: 'update', payload, match: Object.fromEntries(filters) });
            resolve({ error: null });
          },
        };
        return sub;
      },

      delete: () => {
        const sub: Record<string, unknown> = {
          eq: (c: string, v: unknown) => {
            filters.push([c, v]);
            return sub;
          },
          then: (resolve: (v: unknown) => void) => {
            tables[table] = (tables[table] ?? []).filter((r) => !matches(r, filters));
            writes.push({ table, op: 'delete', match: Object.fromEntries(filters) });
            resolve({ error: null });
          },
        };
        return sub;
      },
    };

    return builder;
  }

  return {
    client: { from },
    tables,
    writes,
    logs: () => writes.filter((w) => w.table === 'delivery_log').map((w) => w.payload as Row),
    failNextLogInsert: (code: string) => {
      insertErrorCode = code;
    },
  };
}

/* ---------------------------------------------------------- fake devices - */

async function makeDevice(endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    id: endpoint,
    endpoint,
    p256dh: bytesToB64url(raw),
    auth: bytesToB64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const VAPID = {
  publicKey: '',
  privateKey: '',
  subject: 'mailto:a@b.c',
};

beforeEach(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  VAPID.publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  VAPID.privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d!;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Intercepts fetch and replies per-host, recording every call. */
function stubFetch(handler: (url: string) => { status: number; body?: string }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = handler(url);
    return Promise.resolve(
      new Response(body ?? '{}', { status, headers: { 'content-type': 'application/json' } }),
    );
  });
  return calls;
}

const deps = (db: ReturnType<typeof makeDb>) => ({
  db: db.client,
  telegramBotToken: 'test-token',
  vapid: VAPID,
});

/* ------------------------------------------------------------------ tests */

describe('no channel configured', () => {
  it('records a skip rather than failing silently', async () => {
    const db = makeDb({ notification_channels: [], delivery_log: [] });
    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(out.delivered).toBe(false);
    expect(db.logs()).toHaveLength(1);
    expect(db.logs()[0]).toMatchObject({ status: 'skipped', local_day: '2026-08-15' });
    expect(String(db.logs()[0].error)).toMatch(/no notification channel/i);
  });
});

describe('a single working channel', () => {
  it('delivers and logs a send', async () => {
    const db = makeDb({
      notification_channels: [
        { id: 'c1', user_id: 'u1', kind: 'telegram', config: { chat_id: '42' }, priority: 10, enabled: true, failed_at: null },
      ],
      delivery_log: [],
    });
    const calls = stubFetch(() => ({ status: 200 }));

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(out).toMatchObject({ delivered: true, channel: 'telegram' });
    expect(calls[0]).toContain('api.telegram.org/bottest-token/sendMessage');
    expect(db.logs()[0]).toMatchObject({ status: 'sent', channel: 'telegram' });
  });

  it('stores what was sent, so a wrong digest is diagnosable later', async () => {
    const db = makeDb({
      notification_channels: [
        { id: 'c1', user_id: 'u1', kind: 'telegram', config: { chat_id: '42' }, priority: 10, enabled: true, failed_at: null },
      ],
      delivery_log: [],
    });
    stubFetch(() => ({ status: 200 }));

    await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(db.logs()[0].payload).toEqual({ title: 'Sat, Aug 15', body: 'Nothing due.' });
  });
});

describe('priority and fallthrough', () => {
  const twoChannels = async () => ({
    notification_channels: [
      { id: 'c-tg', user_id: 'u1', kind: 'telegram', config: { chat_id: '42' }, priority: 20, enabled: true, failed_at: null },
      { id: 'c-wp', user_id: 'u1', kind: 'webpush', config: {}, priority: 10, enabled: true, failed_at: null },
    ],
    push_subscriptions: [{ ...(await makeDevice('https://web.push.apple.com/dev1')), user_id: 'u1' }],
    delivery_log: [],
  });

  it('tries the lower priority number first', async () => {
    const db = makeDb(await twoChannels());
    const calls = stubFetch(() => ({ status: 201 }));

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(out.channel).toBe('webpush');
    expect(calls[0]).toContain('web.push.apple.com');
  });

  it('stops at the first success — no double notification', async () => {
    const db = makeDb(await twoChannels());
    const calls = stubFetch(() => ({ status: 201 }));

    await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(calls.filter((c) => c.includes('telegram'))).toHaveLength(0);
    expect(db.logs().filter((l) => l.status === 'sent')).toHaveLength(1);
  });

  it('falls through to Telegram when Web Push fails, and the digest still arrives', async () => {
    // This is the Web Push soak in miniature: push goes first, Telegram
    // silently catches the miss, and the log records who actually delivered.
    const db = makeDb(await twoChannels());
    stubFetch((url) => (url.includes('telegram') ? { status: 200 } : { status: 500 }));

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(out).toMatchObject({ delivered: true, channel: 'telegram' });
    expect(db.logs().map((l) => `${l.channel}:${l.status}`)).toEqual([
      'webpush:failed',
      'telegram:sent',
    ]);
  });

  it('reports not delivered when every channel fails', async () => {
    const db = makeDb(await twoChannels());
    stubFetch(() => ({ status: 500 }));

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(out.delivered).toBe(false);
    expect(out.errors).toHaveLength(2);
    expect(db.logs().every((l) => l.status === 'failed')).toBe(true);
  });
});

describe('retiring dead channels — narrow on purpose', () => {
  const telegramOnly = {
    notification_channels: [
      { id: 'c1', user_id: 'u1', kind: 'telegram', config: { chat_id: '42' }, priority: 10, enabled: true, failed_at: null },
    ],
    delivery_log: [],
  };

  it('retires a Telegram bot the user has blocked', async () => {
    const db = makeDb(telegramOnly);
    stubFetch(() => ({ status: 403, body: JSON.stringify({ description: 'bot was blocked by the user' }) }));

    await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(db.tables.notification_channels[0].failed_at).toBeTruthy();
  });

  it('does NOT retire a channel over a transient 500', async () => {
    // Retiring a live channel silently stops every future notification, which
    // is a far worse outcome than one missed digest.
    const db = makeDb(telegramOnly);
    stubFetch(() => ({ status: 500, body: JSON.stringify({ description: 'internal' }) }));

    await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(db.tables.notification_channels[0].failed_at).toBeNull();
  });

  it('does NOT retire a channel over a rate limit', async () => {
    const db = makeDb(telegramOnly);
    stubFetch(() => ({ status: 429, body: JSON.stringify({ description: 'Too Many Requests' }) }));

    await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(db.tables.notification_channels[0].failed_at).toBeNull();
  });

  it('skips a channel that was already retired', async () => {
    const db = makeDb({
      notification_channels: [
        { id: 'c1', user_id: 'u1', kind: 'telegram', config: { chat_id: '42' }, priority: 10, enabled: true, failed_at: '2026-08-01T00:00:00Z' },
      ],
      delivery_log: [],
    });
    const calls = stubFetch(() => ({ status: 200 }));

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(calls).toHaveLength(0);
    expect(out.delivered).toBe(false);
    expect(db.logs()[0].status).toBe('skipped');
  });
});

describe('Web Push devices', () => {
  async function withDevices(endpoints: string[]) {
    const subs = await Promise.all(endpoints.map(makeDevice));
    return makeDb({
      notification_channels: [
        { id: 'c-wp', user_id: 'u1', kind: 'webpush', config: {}, priority: 10, enabled: true, failed_at: null },
      ],
      push_subscriptions: subs.map((s) => ({ ...s, user_id: 'u1' })),
      delivery_log: [],
    });
  }

  it('counts one device succeeding as delivered', async () => {
    const db = await withDevices(['https://push.example/a', 'https://push.example/b']);
    stubFetch((url) => ({ status: url.endsWith('/a') ? 500 : 201 }));

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);
    expect(out).toMatchObject({ delivered: true, channel: 'webpush' });
  });

  it('deletes an endpoint that returns 410 Gone', async () => {
    // Routine on iOS rather than exceptional: offloading the PWA invalidates
    // the subscription with no error anywhere.
    const db = await withDevices(['https://push.example/a', 'https://push.example/b']);
    stubFetch((url) => ({ status: url.endsWith('/a') ? 410 : 201 }));

    await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    const left = db.tables.push_subscriptions.map((s) => s.endpoint);
    expect(left).toEqual(['https://push.example/b']);
  });

  it('records a success timestamp on the device that worked', async () => {
    const db = await withDevices(['https://push.example/a']);
    stubFetch(() => ({ status: 201 }));

    await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(db.tables.push_subscriptions[0].last_success_at).toBeTruthy();
  });

  it('retires the channel only when every device is gone', async () => {
    const db = await withDevices(['https://push.example/a', 'https://push.example/b']);
    stubFetch(() => ({ status: 410 }));

    await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(db.tables.push_subscriptions).toHaveLength(0);
    expect(db.tables.notification_channels[0].failed_at).toBeTruthy();
  });

  it('keeps the channel alive when one device is gone and another is merely failing', async () => {
    // Otherwise reinstalling the app on one device would permanently disable
    // push everywhere.
    const db = await withDevices(['https://push.example/a', 'https://push.example/b']);
    stubFetch((url) => ({ status: url.endsWith('/a') ? 410 : 500 }));

    await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(db.tables.notification_channels[0].failed_at).toBeNull();
  });

  it('fails without retiring the channel when no device is subscribed', async () => {
    const db = makeDb({
      notification_channels: [
        { id: 'c-wp', user_id: 'u1', kind: 'webpush', config: {}, priority: 10, enabled: true, failed_at: null },
      ],
      push_subscriptions: [],
      delivery_log: [],
    });
    stubFetch(() => ({ status: 201 }));

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(out.delivered).toBe(false);
    expect(db.tables.notification_channels[0].failed_at).toBeNull();
  });
});

describe('idempotency', () => {
  it('treats a duplicate-key rejection as already delivered, not as a failure', async () => {
    // The scheduler fires every 15 minutes and will re-enter the window. Losing
    // this race must not be reported as a broken pipeline.
    const db = makeDb({
      notification_channels: [
        { id: 'c1', user_id: 'u1', kind: 'telegram', config: { chat_id: '42' }, priority: 10, enabled: true, failed_at: null },
      ],
      delivery_log: [],
    });
    stubFetch(() => ({ status: 200 }));
    db.failNextLogInsert('23505');

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(out).toMatchObject({ delivered: true, duplicate: true });
  });
});

describe('misconfiguration is reported, not crashed on', () => {
  it('retires a Telegram channel with no chat_id', async () => {
    const db = makeDb({
      notification_channels: [
        { id: 'c1', user_id: 'u1', kind: 'telegram', config: {}, priority: 10, enabled: true, failed_at: null },
      ],
      delivery_log: [],
    });
    const calls = stubFetch(() => ({ status: 200 }));

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(calls).toHaveLength(0);
    expect(out.delivered).toBe(false);
    expect(db.tables.notification_channels[0].failed_at).toBeTruthy();
  });

  it('survives the network throwing outright', async () => {
    const db = makeDb({
      notification_channels: [
        { id: 'c1', user_id: 'u1', kind: 'telegram', config: { chat_id: '42' }, priority: 10, enabled: true, failed_at: null },
      ],
      delivery_log: [],
    });
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network unreachable')));

    const out = await deliver(deps(db), 'u1', 'digest', '2026-08-15', MSG);

    expect(out.delivered).toBe(false);
    expect(out.errors[0]).toMatch(/network unreachable/);
    expect(db.tables.notification_channels[0].failed_at).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { parseBody, readBody, readJson } from '../../supabase/functions/_shared/body';

const schema = {
  title: { type: 'string', max: 10 },
  pdf: { type: 'file', maxChars: 20 },
} as const;

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://x.test', { method: 'POST', body, headers });

describe('parseBody', () => {
  it('returns only the fields in the schema', () => {
    const r = parseBody({ title: 'hi', extra: 'dropped' }, schema);
    expect(r).toEqual({ ok: true, body: { title: 'hi' } });
  });

  it('treats absent and null as undefined', () => {
    const r = parseBody({ title: null }, schema);
    expect(r).toEqual({ ok: true, body: {} });
  });

  it('rejects text that is not text, which used to be a 500', () => {
    const r = parseBody({ title: 5 }, schema);
    expect(r).toEqual({ ok: false, status: 400, error: 'title must be text' });
  });

  it('rejects text over its ceiling rather than truncating it', () => {
    const r = parseBody({ title: 'x'.repeat(11) }, schema);
    expect(r).toEqual({ ok: false, status: 413, error: 'title is too long' });
  });

  it('accepts text exactly at its ceiling', () => {
    expect(parseBody({ title: 'x'.repeat(10) }, schema).ok).toBe(true);
  });

  it('rejects a body that is not an object', () => {
    for (const raw of [null, 'text', 4, [1]]) {
      expect(parseBody(raw, schema)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('accepts a file and keeps only data and mimeType', () => {
    const r = parseBody({ pdf: { data: 'abc', mimeType: 'application/pdf', x: 1 } }, schema);
    expect(r).toEqual({ ok: true, body: { pdf: { data: 'abc', mimeType: 'application/pdf' } } });
  });

  it('rejects a file with no data, which used to throw on .length', () => {
    expect(parseBody({ pdf: { mimeType: 'application/pdf' } }, schema)).toMatchObject({ ok: false, status: 400 });
    expect(parseBody({ pdf: 'abc' }, schema)).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects a file over its ceiling, and an absurd mime type', () => {
    expect(parseBody({ pdf: { data: 'x'.repeat(21), mimeType: 'a/b' } }, schema)).toMatchObject({ ok: false, status: 413 });
    expect(parseBody({ pdf: { data: 'x', mimeType: 'a'.repeat(101) } }, schema)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('readJson', () => {
  it('parses JSON', async () => {
    expect(await readJson(post('{"a":1}'), 100)).toEqual({ ok: true, body: { a: 1 } });
  });

  it('rejects unreadable JSON', async () => {
    expect(await readJson(post('{nope'), 100)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses on the declared length before reading', async () => {
    const r = await readJson(post('{}', { 'content-length': '5000' }), 100);
    expect(r).toMatchObject({ ok: false, status: 413 });
  });

  it('refuses on the real length when the header is absent or wrong', async () => {
    const r = await readJson(post(JSON.stringify({ a: 'x'.repeat(200) })), 100);
    expect(r).toMatchObject({ ok: false, status: 413 });
  });

  it('stops reading at the cap when no length is declared, instead of buffering it all', async () => {
    // A chunked upload with no content-length: a million 1 KB chunks on offer,
    // a cap of 10 KB. Reading must stop near the cap, not drain the stream.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024).fill(120));
        if (pulled >= 1_000_000) controller.close();
      },
    });
    const req = new Request('https://x.test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    const r = await readJson(req, 10 * 1024);
    expect(r).toMatchObject({ ok: false, status: 413 });
    // The stream's queue holds a few chunks ahead; the point is it is nowhere near all of them.
    expect(pulled).toBeLessThan(100);
  });

  it('counts bytes, not characters', async () => {
    // 60 two-byte characters is 120 bytes: over a cap of 100 although only 60 long.
    const r = await readJson(post(JSON.stringify({ a: 'é'.repeat(60) })), 100);
    expect(r).toMatchObject({ ok: false, status: 413 });
  });

  it('treats a request with no body as unreadable JSON, not as a crash', async () => {
    const r = await readJson(new Request('https://x.test', { method: 'POST' }), 100);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('reads a body that arrives in several chunks and is exactly at the cap', async () => {
    const json = JSON.stringify({ a: 'x'.repeat(10) });
    const bytes = new TextEncoder().encode(json);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 5));
        c.enqueue(bytes.slice(5));
        c.close();
      },
    });
    const req = new Request('https://x.test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    expect(await readJson(req, bytes.length)).toEqual({ ok: true, body: { a: 'xxxxxxxxxx' } });
  });
});

describe('readBody', () => {
  it('reads and checks in one step', async () => {
    const r = await readBody(post('{"title":"ok"}'), schema, 1000);
    expect(r).toEqual({ ok: true, body: { title: 'ok' } });
  });

  it('surfaces a parse failure before a schema failure', async () => {
    expect(await readBody(post('nope'), schema, 1000)).toMatchObject({ ok: false, status: 400, error: 'expected JSON' });
  });
});

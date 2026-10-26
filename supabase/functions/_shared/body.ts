/**
 * Reading a request body that someone else wrote.
 *
 * The functions used to declare the body as a TypeScript object and then trust
 * it: `(body.title ?? '').trim()` is a TypeError, and so a 500, when title is a
 * number, and `pdf.data.length` is the same when data is missing. A 500 reads
 * as "the server is broken", which is the wrong thing to tell a client that
 * sent something malformed. It also meant nothing capped the size of what was
 * read before it was parsed.
 *
 * Deliberately small and dependency-free: it states each field's type and its
 * hard ceiling, returns a body of exactly that shape or a plain error, and
 * leaves every behaviour that already worked (trimming, slicing to a working
 * length) in the callers. A ceiling here is a rejection, not a truncation.
 */

export type FieldSpec =
  /** Text, rejected above `max` characters. */
  | { type: 'string'; max: number }
  /** A base64 document: `{ data, mimeType }`, rejected above `maxChars` of data. */
  | { type: 'file'; maxChars: number };

export type Schema = Record<string, FieldSpec>;

export interface FileValue {
  data: string;
  mimeType: string;
}

export type Parsed<S extends Schema> = {
  [K in keyof S]?: S[K] extends { type: 'file' } ? FileValue : string;
};

export type BodyResult<T> = { ok: true; body: T } | { ok: false; status: 400 | 413; error: string };

const MIME_MAX = 100;

/**
 * The body as bytes, or null once it has grown past `maxBytes`.
 *
 * Read a chunk at a time and abandoned the moment the total passes the cap. A
 * request that declares no length (chunked encoding), or lies about it, would
 * otherwise be buffered whole by `req.text()` before any size check could run,
 * so the cap would protect against honest clients only.
 */
async function readCapped(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  return joined;
}

/** Read and parse JSON, refusing anything larger than `maxBytes` without reading past it. */
export async function readJson(req: Request, maxBytes: number): Promise<BodyResult<unknown>> {
  // Cheap and early for an honest client: no need to read a body that says it is too big.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: 'request is too large' };
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(req, maxBytes);
  } catch {
    return { ok: false, status: 400, error: 'expected JSON' };
  }
  // The header can be absent or wrong; what actually arrives is the truth.
  if (bytes === null) return { ok: false, status: 413, error: 'request is too large' };

  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'expected JSON' };
  }
}

/**
 * Check a parsed body against a schema. Absent and null fields come back
 * undefined; a field of the wrong type, or over its ceiling, is an error naming
 * it. Fields not in the schema are dropped, so a caller cannot reach for one
 * that was never checked.
 */
export function parseBody<S extends Schema>(raw: unknown, schema: S): BodyResult<Parsed<S>> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'expected a JSON object' };
  }
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [name, spec] of Object.entries(schema)) {
    const value = input[name];
    if (value === undefined || value === null) continue;

    if (spec.type === 'string') {
      if (typeof value !== 'string') return { ok: false, status: 400, error: `${name} must be text` };
      if (value.length > spec.max) return { ok: false, status: 413, error: `${name} is too long` };
      out[name] = value;
      continue;
    }

    const file = value as Record<string, unknown>;
    if (typeof value !== 'object' || Array.isArray(value) || typeof file.data !== 'string' || typeof file.mimeType !== 'string') {
      return { ok: false, status: 400, error: `${name} must be { data, mimeType }` };
    }
    if (file.data.length > spec.maxChars) return { ok: false, status: 413, error: `${name} is too large` };
    if (file.mimeType.length > MIME_MAX) return { ok: false, status: 400, error: `${name} has an invalid type` };
    out[name] = { data: file.data, mimeType: file.mimeType };
  }

  return { ok: true, body: out as Parsed<S> };
}

/** readJson then parseBody, for the common case. */
export async function readBody<S extends Schema>(
  req: Request,
  schema: S,
  maxBytes: number,
): Promise<BodyResult<Parsed<S>>> {
  const json = await readJson(req, maxBytes);
  if (!json.ok) return json;
  return parseBody(json.body, schema);
}

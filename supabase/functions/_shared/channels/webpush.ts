/**
 * Web Push delivery — RFC 8291 message encryption, RFC 8292 VAPID auth.
 *
 * Written against Web Crypto rather than a Node library on purpose. The usual
 * choice, `web-push`, depends on Node's crypto module, and whether it works in
 * the Deno edge runtime is exactly the kind of thing that fails at 07:00 on a
 * Tuesday rather than at deploy time. Everything below runs unmodified in Deno,
 * in the browser, and in Node — which also means the encryption is testable on
 * a laptop with no network and no push service.
 *
 * The payload is encrypted end-to-end: Apple, Google and Mozilla relay the
 * ciphertext but hold none of the keys and cannot read the digest. That is the
 * one genuine privacy advantage this channel has over Telegram.
 *
 * ---------------------------------------------------------------------------
 * A caution that matters more than the code:
 *
 * A 201 from Apple means Apple ACCEPTED the push. It does NOT mean the phone
 * displayed it. iOS can accept a push and drop it — if the PWA was offloaded,
 * if the subscription has silently rotted, if Low Power Mode is throttling. So
 * a green delivery_log row is necessary but not sufficient evidence that Web
 * Push works, and the soak test has to be confirmed by the phone, not by us.
 * ---------------------------------------------------------------------------
 */

import type { OutboundMessage, SendResult } from '../types.ts';

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/* ---------------------------------------------------------------------------
 * base64url
 * ------------------------------------------------------------------------ */

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: Uint8Array): string {
  let bin = '';
  for (const byte of b) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/* ---------------------------------------------------------------------------
 * HKDF, as RFC 8291 uses it: one-block expand, so the info is always suffixed
 * with a single 0x01 counter byte and the output truncated.
 * ------------------------------------------------------------------------ */

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

export async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/* ---------------------------------------------------------------------------
 * RFC 8291 payload encryption (Content-Encoding: aes128gcm)
 * ------------------------------------------------------------------------ */

export async function encryptPayload(
  plaintext: Uint8Array,
  uaPublicKey: Uint8Array,
  authSecret: Uint8Array,
  /** Injectable for tests; real sends always use fresh random values. */
  opts?: { salt?: Uint8Array; serverKeys?: CryptoKeyPair },
): Promise<Uint8Array> {
  const salt = opts?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const serverKeys =
    opts?.serverKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair);

  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublicKey as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256),
  );

  // Step one of RFC 8291 §3.3: mix the shared secret with the subscription's
  // auth secret, binding the key to this specific subscription.
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublicKey, asPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  // A single record, so the padding delimiter is 0x02 ("last record").
  const padded = concat(plaintext, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
      aesKey,
      padded as BufferSource,
    ),
  );

  // Header: salt(16) || record size(4, big-endian) || key id length(1) || key id
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);

  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/**
 * Decrypts an aes128gcm body. Exists so the encryption above can be verified
 * end to end in a unit test rather than trusted — the only way to be confident
 * in crypto you cannot test against a live push service.
 */
export async function decryptPayload(
  body: Uint8Array,
  uaPrivateKey: CryptoKey,
  uaPublicKey: Uint8Array,
  authSecret: Uint8Array,
): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const idLen = body[20];
  const asPublic = body.slice(21, 21 + idLen);
  const ciphertext = body.slice(21 + idLen);

  const asKey = await crypto.subtle.importKey(
    'raw',
    asPublic as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivateKey, 256),
  );

  const keyInfo = concat(utf8('WebPush: info\0'), uaPublicKey, asPublic);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'decrypt',
  ]);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
      aesKey,
      ciphertext as BufferSource,
    ),
  );

  // Strip the trailing padding delimiter.
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  return padded.slice(0, end - 1);
}

/* ---------------------------------------------------------------------------
 * RFC 8292 VAPID
 * ------------------------------------------------------------------------ */

async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlToBytes(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point');
  }

  // The private key is the raw 32-byte scalar; the coordinates come from the
  // public point. Assembled as a JWK because Web Crypto has no raw import for
  // EC private keys.
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65)),
      d: keys.privateKey,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

export async function vapidAuthHeader(
  endpoint: string,
  keys: VapidKeys,
  now: Date = new Date(),
): Promise<string> {
  const audience = new URL(endpoint).origin;

  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(
    utf8(
      JSON.stringify({
        aud: audience,
        // Twelve hours. The spec caps this at 24; staying well under avoids
        // rejection from services that are strict about clock skew.
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  );

  const signingInput = utf8(`${header}.${payload}`);
  const key = await importVapidPrivateKey(keys);

  // ECDSA via Web Crypto already returns the raw r||s concatenation that JWS
  // requires, so no DER unwrapping is needed.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput as BufferSource),
  );

  const jwt = `${header}.${payload}.${bytesToB64url(sig)}`;
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}

/* ---------------------------------------------------------------------------
 * Send
 * ------------------------------------------------------------------------ */

/**
 * 404 and 410 are the push service telling us this subscription no longer
 * exists. That is routine on iOS rather than exceptional, so the row gets
 * retired and the client re-subscribes on next launch. Everything else is
 * treated as transient.
 */
function isDead(status: number): boolean {
  return status === 404 || status === 410;
}

export async function sendWebPush(
  msg: OutboundMessage,
  sub: PushSubscription,
  keys: VapidKeys,
): Promise<SendResult> {
  if (!keys.publicKey || !keys.privateKey) {
    return { ok: false, error: 'VAPID keys are not set', dead: false };
  }

  try {
    const payload = utf8(
      JSON.stringify({ title: msg.title, body: msg.body, deepLink: msg.deepLink }),
    );

    const body = await encryptPayload(
      payload,
      b64urlToBytes(sub.p256dh),
      b64urlToBytes(sub.auth),
    );

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthHeader(sub.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        // Apple requires a user-visible notification. A push that resolves to
        // no notification gets the subscription revoked, so TTL and urgency are
        // set conservatively rather than left to the service's defaults.
        TTL: '86400',
        Urgency: 'normal',
      },
      body: body as BodyInit,
    });

    if (res.ok) return { ok: true };

    const detail = await res.text().catch(() => '');
    return {
      ok: false,
      error: `webpush: HTTP ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`,
      dead: isDead(res.status),
    };
  } catch (e) {
    return { ok: false, error: `webpush: ${(e as Error).message}`, dead: false };
  }
}

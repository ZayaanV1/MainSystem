import { describe, it, expect } from 'vitest';
import {
  b64urlToBytes,
  bytesToB64url,
  decryptPayload,
  encryptPayload,
  vapidAuthHeader,
} from '../../supabase/functions/_shared/channels/webpush';

/**
 * Web Push crypto cannot be verified against a live push service from a
 * laptop, and "it returned 201" would not prove the payload decrypts anyway —
 * Apple relays ciphertext it cannot read. So it is verified structurally and
 * by round-trip instead: we play the role of the phone, decrypt what we sent,
 * and check the wire format byte by byte against RFC 8291.
 */

const utf8 = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array) => new TextDecoder().decode(b);

/** Stands in for a browser's push subscription keypair. */
async function makeSubscriberKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return { pair, publicKey, authSecret };
}

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    for (const len of [0, 1, 2, 3, 16, 32, 65, 200]) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      expect(Array.from(b64urlToBytes(bytesToB64url(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('produces URL-safe output with no padding', () => {
    const encoded = bytesToB64url(crypto.getRandomValues(new Uint8Array(64)));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('RFC 8291 payload encryption', () => {
  it('produces a body the subscriber can actually decrypt', async () => {
    const ua = await makeSubscriberKeys();
    const plaintext = utf8(JSON.stringify({ title: 'Sat, Aug 15', body: 'Nothing due.' }));

    const body = await encryptPayload(plaintext, ua.publicKey, ua.authSecret);
    const recovered = await decryptPayload(body, ua.pair.privateKey, ua.publicKey, ua.authSecret);

    expect(str(recovered)).toBe(str(plaintext));
  });

  it('lays out the header exactly as the spec requires', async () => {
    const ua = await makeSubscriberKeys();
    const body = await encryptPayload(utf8('x'), ua.publicKey, ua.authSecret);

    // salt(16) || record size(4, big-endian) || key id length(1) || key id(65)
    const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false);
    expect(recordSize).toBe(4096);
    expect(body[20]).toBe(65);

    const asPublic = body.slice(21, 86);
    expect(asPublic[0]).toBe(0x04); // uncompressed point

    // 16 salt + 4 rs + 1 idlen + 65 key + ciphertext(1 byte + 1 delimiter + 16 tag)
    expect(body.length).toBe(16 + 4 + 1 + 65 + 18);
  });

  it('uses a fresh salt and ephemeral key on every send', async () => {
    const ua = await makeSubscriberKeys();
    const a = await encryptPayload(utf8('same'), ua.publicKey, ua.authSecret);
    const b = await encryptPayload(utf8('same'), ua.publicKey, ua.authSecret);

    expect(bytesToB64url(a.slice(0, 16))).not.toBe(bytesToB64url(b.slice(0, 16)));
    expect(bytesToB64url(a.slice(21, 86))).not.toBe(bytesToB64url(b.slice(21, 86)));
    expect(bytesToB64url(a)).not.toBe(bytesToB64url(b));
  });

  it('cannot be decrypted with the wrong auth secret', async () => {
    const ua = await makeSubscriberKeys();
    const wrongAuth = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptPayload(utf8('secret'), ua.publicKey, ua.authSecret);

    await expect(
      decryptPayload(body, ua.pair.privateKey, ua.publicKey, wrongAuth),
    ).rejects.toThrow();
  });

  it('cannot be decrypted by a different subscriber', async () => {
    const ua = await makeSubscriberKeys();
    const eavesdropper = await makeSubscriberKeys();
    const body = await encryptPayload(utf8('secret'), ua.publicKey, ua.authSecret);

    await expect(
      decryptPayload(body, eavesdropper.pair.privateKey, ua.publicKey, ua.authSecret),
    ).rejects.toThrow();
  });

  it('handles a realistically long digest', async () => {
    const ua = await makeSubscriberKeys();
    const long = utf8(
      JSON.stringify({
        title: 'Mon, Sep 14',
        body: Array.from({ length: 20 }, (_, i) => `- Assignment ${i + 1}, due in ${i} days`).join(
          '\n',
        ),
      }),
    );

    const body = await encryptPayload(long, ua.publicKey, ua.authSecret);
    const recovered = await decryptPayload(body, ua.pair.privateKey, ua.publicKey, ua.authSecret);
    expect(str(recovered)).toBe(str(long));
  });
});

describe('RFC 8292 VAPID', () => {
  /** Mirrors what `web-push generate-vapid-keys` hands you. */
  async function makeVapidKeys() {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;

    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

    return {
      keys: {
        publicKey: bytesToB64url(raw),
        privateKey: jwk.d!,
        subject: 'mailto:zayaanvastani21@gmail.com',
      },
      verifyKey: pair.publicKey,
    };
  }

  it('signs a JWT that verifies against the advertised public key', async () => {
    const { keys, verifyKey } = await makeVapidKeys();
    const header = await vapidAuthHeader('https://web.push.apple.com/abc123', keys);

    const jwt = header.match(/t=([^,]+)/)![1];
    const [h, p, s] = jwt.split('.');

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      b64urlToBytes(s) as BufferSource,
      utf8(`${h}.${p}`) as BufferSource,
    );
    expect(valid).toBe(true);
  });

  it('scopes the audience to the push service origin, not the full endpoint', async () => {
    const { keys } = await makeVapidKeys();
    const header = await vapidAuthHeader('https://web.push.apple.com/some/long/path?x=1', keys);
    const payload = JSON.parse(
      str(b64urlToBytes(header.match(/t=([^,]+)/)![1].split('.')[1])),
    );

    // A JWT scoped to the full path is rejected by Apple.
    expect(payload.aud).toBe('https://web.push.apple.com');
    expect(payload.sub).toBe('mailto:zayaanvastani21@gmail.com');
  });

  it('expires within the 24-hour cap the spec imposes', async () => {
    const { keys } = await makeVapidKeys();
    const now = new Date('2026-08-15T11:00:00Z');
    const header = await vapidAuthHeader('https://web.push.apple.com/abc', keys, now);
    const payload = JSON.parse(
      str(b64urlToBytes(header.match(/t=([^,]+)/)![1].split('.')[1])),
    );

    const hours = (payload.exp - now.getTime() / 1000) / 3600;
    expect(hours).toBe(12);
    expect(hours).toBeLessThan(24);
  });

  it('advertises the public key alongside the token', async () => {
    const { keys } = await makeVapidKeys();
    const header = await vapidAuthHeader('https://fcm.googleapis.com/fcm/send/xyz', keys);
    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(header.endsWith(`k=${keys.publicKey}`)).toBe(true);
  });

  it('rejects a malformed public key rather than sending a bad token', async () => {
    await expect(
      vapidAuthHeader('https://web.push.apple.com/abc', {
        publicKey: bytesToB64url(new Uint8Array(32)),
        privateKey: 'x',
        subject: 'mailto:a@b.c',
      }),
    ).rejects.toThrow(/65-byte uncompressed/);
  });
});

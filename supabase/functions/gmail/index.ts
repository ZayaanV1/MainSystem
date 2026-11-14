/**
 * gmail — connecting an account's Gmail, read-only, so Abood can search it.
 *
 *   POST with the user's JWT: { action: 'status' | 'start' | 'disconnect' }.
 *     start returns Google's consent address; the app sends the browser there.
 *   GET from Google (?code&state): the consent came back. The code is traded
 *     for a refresh token, stored in gmail_links, and the browser is sent back
 *     to Settings.
 *
 * Google's redirect carries no login, so `state` carries the user: their id
 * and an expiry, signed with HMAC so nobody can attach their Gmail to someone
 * else's account or replay an old consent. The signing key is the service-role
 * key, which never leaves the server.
 */

import { corsFor } from '../_shared/cors.ts';
import { readBody } from '../_shared/body.ts';
import { sameSecret } from '../_shared/secret.ts';
import { GMAIL_SCOPE } from '../_shared/gmail.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string): string => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const APP_URL = env('APP_URL');
const CLIENT_ID = env('GOOGLE_CLIENT_ID');
const CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET');
const REDIRECT = `${SUPABASE_URL}/functions/v1/gmail`;
const STATE_MS = 10 * 60_000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function sign(text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_ROLE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The user a returning consent belongs to, or null if the state is forged or stale. */
async function userOfState(state: string): Promise<string | null> {
  const [userId, expires, mac] = state.split('.');
  if (!userId || !expires || !mac || Number(expires) < Date.now()) return null;
  return sameSecret(mac, await sign(`${userId}.${expires}`)) ? userId : null;
}

const back = (result: string) => Response.redirect(`${APP_URL}/settings/abood?gmail=${result}`, 302);

async function callback(url: URL): Promise<Response> {
  const userId = await userOfState(url.searchParams.get('state') ?? '');
  const code = url.searchParams.get('code');
  if (!userId) return back('expired');
  if (!code) return back('declined');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  });
  const token = await res.json().catch(() => ({}));
  if (!res.ok || !token.refresh_token) {
    console.error('gmail token exchange failed', res.status, token.error);
    return back('failed');
  }
  if (!String(token.scope ?? '').includes(GMAIL_SCOPE)) return back('declined');

  const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

  const { error } = await admin
    .from('gmail_links')
    .upsert({ user_id: userId, email: profile.emailAddress ?? null, refresh_token: token.refresh_token, created_at: new Date().toISOString() });
  if (error) {
    console.error('gmail link not saved', error.message);
    return back('failed');
  }
  return back('connected');
}

Deno.serve(async (req) => {
  const cors = corsFor(req, APP_URL);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method === 'GET') return callback(new URL(req.url));
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'not authorised' }, 401);
  const { data: user, error: userError } = await admin.auth.getUser(auth.slice(7));
  if (userError || !user?.user) return json({ error: 'not authorised' }, 401);
  const userId = user.user.id;

  const read = await readBody(req, { action: { type: 'string', max: 20 } }, 1024);
  if (!read.ok) return json({ ok: false, reason: read.error }, read.status);
  const action = read.body.action;

  if (action === 'status') {
    const { data } = await admin.from('gmail_links').select('email').eq('user_id', userId).maybeSingle();
    return json({ ok: true, configured: Boolean(CLIENT_ID && CLIENT_SECRET), connected: Boolean(data), email: data?.email ?? null });
  }

  if (action === 'start') {
    if (!CLIENT_ID || !CLIENT_SECRET) return json({ ok: false, reason: 'Gmail is not set up on the server yet.' });
    const expires = String(Date.now() + STATE_MS);
    const state = `${userId}.${expires}.${await sign(`${userId}.${expires}`)}`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: GMAIL_SCOPE,
      access_type: 'offline',
      // Always ask, so Google always hands back a refresh token.
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
    }).toString();
    return json({ ok: true, url: url.toString() });
  }

  if (action === 'disconnect') {
    const { data } = await admin.from('gmail_links').select('refresh_token').eq('user_id', userId).maybeSingle();
    // Revoke at Google first, so the token stops working even if it was copied; the row goes either way.
    if (data?.refresh_token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(data.refresh_token)}`, { method: 'POST' }).catch(() => null);
    }
    const { error } = await admin.from('gmail_links').delete().eq('user_id', userId);
    return error ? json({ ok: false, reason: 'That did not go through. Try again.' }) : json({ ok: true });
  }

  return json({ ok: false, reason: 'Unknown action.' }, 400);
});

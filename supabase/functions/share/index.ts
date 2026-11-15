/**
 * share — text from an Apple Shortcut into the inbox.
 *
 * The share sheet has no login, so the account's share key is the credential
 * (Settings, Connected apps). Only its SHA-256 is stored. A missing key, a
 * wrong key and a scanner all get the same bare 401. What arrives is written
 * as an inbox thought exactly as sent, to be sorted later like any capture.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { bearer, shareText } from '../_shared/share.ts';

const env = (k: string): string => Deno.env.get(k) ?? '';

/** Per-instance brake on wrong keys, as in `calendar`: a speed bump, not a wall. */
const MISSES = new Map<string, { n: number; until: number }>();
const MISS_LIMIT = 20;

/** A share key in a runaway Shortcut loop stops here rather than filling the inbox. */
const PER_TEN_MINUTES = 30;

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return text('POST only', 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const now = Date.now();
  const seen = MISSES.get(ip);
  const denied = () => {
    const s = MISSES.get(ip);
    if (!s || now > s.until) MISSES.set(ip, { n: 1, until: now + 60_000 });
    else s.n += 1;
    if (MISSES.size > 5_000) for (const [k, v] of MISSES) if (now > v.until) MISSES.delete(k);
    return text('Not signed in. Check the key in your Shortcut.', 401);
  };
  if (seen && now < seen.until && seen.n >= MISS_LIMIT) return text('Not signed in. Check the key in your Shortcut.', 401);

  const key = bearer(req.headers.get('authorization'));
  if (!key) return denied();

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: owner } = await admin
    .from('app_settings')
    .select('user_id')
    .eq('share_token_hash', await sha256Hex(key))
    .maybeSingle();
  if (!owner) return denied();

  const body = shareText(await req.text(), req.headers.get('content-type'));
  if (!body) return text('Nothing to save: the share was empty.', 400);

  const { count } = await admin
    .from('inbox_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', owner.user_id)
    .eq('source', 'share')
    .gte('created_at', new Date(now - 10 * 60_000).toISOString());
  if ((count ?? 0) >= PER_TEN_MINUTES) return text('That is a lot in a few minutes. Try again shortly.', 429);

  const { error } = await admin.from('inbox_items').insert({ user_id: owner.user_id, body, source: 'share' });
  if (error) return text('Could not save it. Try again.', 500);
  return text('Saved to your inbox.', 200);
});

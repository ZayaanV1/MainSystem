import { supabase } from './supabase';

/** Read-only Gmail for Abood (functions/gmail). The app learns whether it is linked, never the token. */
export type GmailStatus = { configured: boolean; connected: boolean; email: string | null };

async function call(action: string): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, reason: 'You are signed out. Sign in and try again.' };
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail`, {
      method: 'POST',
      headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    return (await res.json().catch(() => ({ ok: false, reason: `Gmail setup answered with an error (${res.status}).` }))) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'You look to be offline. Try again when you’re connected.' };
  }
}

const reasonOf = (b: Record<string, unknown>) => (typeof b.reason === 'string' ? b.reason : 'That didn’t work. Try again.');

export async function gmailStatus(): Promise<GmailStatus | string> {
  const b = await call('status');
  return b.ok ? { configured: Boolean(b.configured), connected: Boolean(b.connected), email: (b.email as string) ?? null } : reasonOf(b);
}

/** Sends the browser to Google's consent screen; returns a reason only if it could not. */
export async function connectGmail(): Promise<string | null> {
  const b = await call('start');
  if (!b.ok || typeof b.url !== 'string') return reasonOf(b);
  window.location.href = b.url;
  return null;
}

export async function disconnectGmail(): Promise<string | null> {
  const b = await call('disconnect');
  return b.ok ? null : reasonOf(b);
}

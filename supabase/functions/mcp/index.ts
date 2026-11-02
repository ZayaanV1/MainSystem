/**
 * The planner as a connector for AI apps (Nov 2026): Claude, Claude Code,
 * Cursor or anything else that speaks the Model Context Protocol.
 *
 * Sign-in is Supabase Auth's OAuth 2.1 server. An app that connects is sent
 * to the planner's own consent page (/oauth/consent), the account approves
 * it, and the app comes back with an ordinary access token for that account
 * carrying a client_id claim. Settings > Connected apps lists those apps and
 * disconnects them.
 *
 * Every query below runs with that token, so RLS bounds it exactly as it
 * bounds the app. No service role here: a missing filter cannot cross
 * accounts when the database itself will not.
 *
 * What the tools may do, and what they deliberately may not, is in
 * _shared/connector.ts. The protocol is _shared/mcp.ts.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRpc } from '../_shared/mcp.ts';
import { CONNECTOR_TOOLS, connectorInstructions, type ConnectorCtx } from '../_shared/connector.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const RESOURCE = `${SUPABASE_URL}/functions/v1/mcp`;
const METADATA_URL = `${RESOURCE}/oauth-protected-resource`;
// A request is one JSON-RPC message; tool arguments are short. Anything larger is not ours.
const MAX_BODY = 256 * 1024;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** The challenge that tells an AI app where to sign in (RFC 9728). */
const unauthorised = (detail?: string) =>
  json({ error: 'unauthorized', ...(detail ? { error_description: detail } : {}) }, 401, {
    'WWW-Authenticate': `Bearer resource_metadata="${METADATA_URL}"${detail ? `, error="invalid_token", error_description="${detail}"` : ''}`,
  });

/** The access token's claims. Read only after getUser has verified the token. */
function claims(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1] ?? '';
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname;

  if (req.method === 'GET' && /\/(\.well-known\/)?oauth-protected-resource$/.test(path)) {
    return json(
      {
        resource: RESOURCE,
        authorization_servers: [`${SUPABASE_URL}/auth/v1`],
        bearer_methods_supported: ['header'],
        resource_name: 'Student planner',
      },
      200,
      { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
    );
  }

  // Stateless: no server-sent stream to open, and no session to end.
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, { Allow: 'POST' });

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return unauthorised();
  const token = auth.slice(7).trim();

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return unauthorised('The sign-in has expired or was disconnected.');

  // Only tokens issued to a connected app: the planner's own session tokens
  // have no client_id, and nothing here should accept one copied out of a browser.
  const clientId = claims(token).client_id;
  if (typeof clientId !== 'string' || !clientId) return unauthorised('Connect through the app sign-in, not a copied session.');

  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_BODY) return json({ error: 'request too large' }, 413);
  let message: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: 'request too large' }, 413);
    message = JSON.parse(text);
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  // The account's zone, as every other function reads it; UTC when none was ever chosen.
  const { data: settings } = await db.from('app_settings').select('timezone').eq('user_id', userData.user.id).maybeSingle();
  const tz = ((settings?.timezone as string | null) ?? 'UTC').trim() || 'UTC';

  const ctx: ConnectorCtx = { db, userId: userData.user.id, clientId, tz, now: new Date() };
  const response = await handleRpc(message, CONNECTOR_TOOLS, ctx, {
    name: 'student-planner',
    version: '1.0.0',
    instructions: connectorInstructions(tz),
  });

  if (response === null) return new Response(null, { status: 202 });
  return json(response);
});

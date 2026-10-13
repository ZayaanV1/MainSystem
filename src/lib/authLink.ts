/**
 * What an email link carried, read from the address once and then removed
 * from it.
 *
 * The client does not read the address itself (detectSessionInUrl is off),
 * so a token in it can never be picked up by accident on some later load;
 * this reads it exactly once, at start, on purpose. Supabase puts a link's
 * session in the fragment (#access_token=…&type=recovery), or an error
 * (#error_description=…) when the link has expired or been used.
 */
export function readAuthLink(hash: string): {
  tokens: { access_token: string; refresh_token: string } | null;
  type: string | null;
  error: string | null;
} | null {
  if (!hash || hash.length < 2) return null;
  const p = new URLSearchParams(hash.slice(1));
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  const error = p.get('error_description') ?? p.get('error');
  if (!access && !error) return null;
  return {
    tokens: access && refresh ? { access_token: access, refresh_token: refresh } : null,
    type: p.get('type'),
    error,
  };
}

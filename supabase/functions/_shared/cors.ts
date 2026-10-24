/**
 * Which websites may call an edge function from a browser.
 *
 * Three functions (assist, dispatch, feeds) each carried their own copy of
 * this, and the copies had already drifted: dispatch allowed one more header.
 * An origin changed in one place would have been missed in the others, and the
 * symptom would be one screen failing while the rest worked. One copy now,
 * with the only difference, the extra headers a function accepts, as an
 * argument.
 *
 * Allowed: the app's own address, any *.vercel.app preview, localhost for
 * development, and the native shell's scheme. Anything else is told the app's
 * address and so is refused by its own browser, which is the point.
 *
 * It used to be pinned to APP_URL alone, which fails badly: deploy to a new
 * URL, or open a Vercel preview build, and every request dies with Safari's
 * opaque "Load failed", with no clue that the cause is a stale environment
 * variable. That is the silent, undiagnosable breakage this project is built
 * to avoid.
 *
 * CORS is not the security boundary here in any case. Every path is gated on a
 * user's token or a shared secret, and the browser sends a bearer token rather
 * than a cookie, so no request is authorised merely by its origin.
 */

export function corsFor(req: Request, appUrl: string, extraHeaders = ''): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed =
    origin === appUrl ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/i.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
    // The native iOS shell (Capacitor) loads the bundle from this scheme.
    origin === 'capacitor://localhost';

  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : appUrl || '*',
    'Access-Control-Allow-Headers': ['authorization, apikey, content-type', extraHeaders].filter(Boolean).join(', '),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

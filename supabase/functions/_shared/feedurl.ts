/**
 * Deciding whether a user-supplied calendar address is safe for the SERVER to
 * fetch.
 *
 * This is the part of the feature with a security edge, and it is worth
 * saying plainly why. The edge function fetches a URL a user typed, on a
 * schedule, from inside the platform's network. Without checks that is a
 * server-side request forgery: an address pointing at `localhost`, a private
 * range or a cloud metadata service would have the platform make requests
 * the user could never make from their own browser.
 *
 * Two layers, because either alone is incomplete:
 *
 *   1. This file, which is pure. It rejects anything whose NAME is already
 *      disqualifying — not https, an IP literal, a non-default port,
 *      credentials in the URL, an internal-looking hostname.
 *   2. The fetcher, which resolves the hostname and rejects it if it points at
 *      a private address. That catches a public-looking name aimed at an
 *      internal one, which no amount of looking at the string can.
 *
 * Both run on EVERY fetch, including every redirect hop, not only when the
 * feed is added. The table is writable through RLS, so "it was checked when it
 * was added" would only be true of feeds added the polite way.
 */

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/** Suffixes that name something on a private network rather than the web. */
const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet'];

export function checkFeedUrl(raw: string): UrlCheck {
  let text = raw.trim().replace(/^<|>$/g, '');

  if (!text) return { ok: false, reason: 'Paste the calendar’s address.' };
  if (text.length > 2000) return { ok: false, reason: 'That address is too long to be a calendar feed.' };

  // webcal:// is the scheme calendar apps use for "subscribe to this". It is
  // https underneath, and Apple and many timetable systems hand these out.
  text = text.replace(/^webcals?:\/\//i, 'https://');

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: 'That isn’t a web address.' };
  }

  if (url.protocol === 'http:') {
    return {
      ok: false,
      reason:
        'That address uses http. A calendar’s secret address has to use https, or it travels unencrypted.',
    };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Calendar addresses start with https://.' };
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'Take the username and password out of the address.' };
  }

  // Anything but the default port is a way of reaching a service that is not
  // a web server — and no calendar provider publishes a feed on one.
  if (url.port && url.port !== '443') {
    return { ok: false, reason: 'Calendar addresses don’t use a custom port.' };
  }

  const host = url.hostname.toLowerCase();

  // An IP literal is never what a calendar provider hands out, and allowing
  // one is allowing the most direct form of the attack this file exists for.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')) {
    return { ok: false, reason: 'Use the calendar’s web address rather than an IP address.' };
  }

  if (
    host === 'localhost' ||
    !host.includes('.') ||
    INTERNAL_SUFFIXES.some((s) => host.endsWith(s))
  ) {
    return { ok: false, reason: 'That address isn’t on the public web.' };
  }

  /*
   * The single most common wrong paste, handled by name. Google shows
   * several addresses for a calendar, and the obvious one — the link in the
   * browser bar, or "Public URL to this calendar" — returns a web page, not a
   * feed. The feed is under /calendar/ical/. Saying which setting to copy is
   * worth far more than "that didn't work".
   */
  if (host === 'calendar.google.com' && !url.pathname.includes('/calendar/ical/')) {
    return {
      ok: false,
      reason:
        'That’s a link to open Google Calendar, not its feed. In Google Calendar, open Settings, choose the calendar, and copy “Secret address in iCal format”.',
    };
  }

  return { ok: true, url: url.toString() };
}

/**
 * Whether a resolved address is somewhere the server must not be sent.
 *
 * Private, loopback, link-local (which is where cloud metadata services
 * live), carrier-grade NAT, multicast and reserved ranges, for both families.
 * An IPv4 address mapped into IPv6 is unwrapped and checked as IPv4, or
 * `::ffff:127.0.0.1` would walk straight through.
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // Both the mapped (::ffff:a.b.c.d) and the older compatible (::a.b.c.d)
  // forms carry an IPv4 address inside an IPv6 one.
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return isPrivateAddress(mapped[1]);

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && Number(v4[3]) === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (addr === '::' || addr === '::1') return true;
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
  if (/^f[cd][0-9a-f]{0,2}:/.test(addr)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(addr)) return true;
  if (/^ff[0-9a-f]{0,2}:/.test(addr)) return true;

  // Anything that is not recognisably an address is treated as unsafe. A
  // parser that cannot read the answer must not be the reason it is allowed.
  return !addr.includes(':');
}

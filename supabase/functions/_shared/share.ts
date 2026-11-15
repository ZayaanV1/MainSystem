/**
 * What the share endpoint accepts: JSON {"text": ...} from a Shortcut, or a
 * plain-text body. Kept free of Deno imports so the browser test runner can check it.
 */

/** Longer shares are cut here rather than refused: the start of a long page is still the thought. */
export const SHARE_MAX_CHARS = 2000;

export function shareText(raw: string, contentType: string | null): string | null {
  let text = raw;
  if ((contentType ?? '').includes('json')) {
    try {
      const v = (JSON.parse(raw) as { text?: unknown })?.text;
      text = typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('\n') : '';
    } catch {
      return null;
    }
  }
  const t = text.trim();
  return t ? t.slice(0, SHARE_MAX_CHARS) : null;
}

/** "Bearer <key>" to the key, or null. */
export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})\s*$/.exec(header ?? '');
  return m ? m[1] : null;
}

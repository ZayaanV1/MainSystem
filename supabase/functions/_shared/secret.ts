/**
 * Comparing a presented secret with the expected one.
 *
 * Five endpoints authenticate by shared secret (the cron header, Telegram's
 * webhook token, the iMessage bridge token), and each had its own copy of this
 * function. Two copies would accept an empty string against an empty string,
 * which is the case where a secret was never configured: the endpoint is then
 * open to anyone who sends nothing. The callers each guarded for it, and the
 * guard is exactly what one forgotten caller omits. So the guard is in the
 * comparison, once.
 *
 * Time is spent on every character regardless of where the first difference
 * is, so the response time reveals nothing about how much of a guess was right.
 */
export function sameSecret(presented: string, expected: string): boolean {
  if (!presented || !expected || presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

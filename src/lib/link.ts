/**
 * Turning a typed link into something safe to store, or nothing.
 *
 * Its own module rather than a helper inside planner.ts, and not only for
 * tidiness: planner.ts constructs the Supabase client at import time, so
 * anything importing a function from it drags a WebSocket-dependent library
 * into every consumer. A pure sanitiser with a security edge should be
 * testable without standing up a database client.
 */

/**
 * Adds https:// when a scheme is missing, because "moodle.example.edu/x" is
 * what a person pastes and rejecting it would be pedantry.
 *
 * Anything that is not http or https afterwards becomes null rather than an
 * error. A stored `javascript:` URL rendered into an anchor is a script that
 * runs when somebody clicks their own assignment, and the app is the thing
 * that put it on screen.
 *
 * The database enforces the same rule with a check constraint. This is the
 * convenience layer; that is the guarantee, and it exists because the client
 * is not the only writer — the chatbot proposes assignments and the syllabus
 * importer creates them.
 */
export function normaliseLink(raw: string | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

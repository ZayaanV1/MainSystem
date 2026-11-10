import { supabase } from './supabase';

/**
 * The account's settings row, read once for everything that needs it at
 * start-up: the zone, the first-run check, the look and the board each made
 * their own request for one or two columns of the same row.
 *
 * Shared only briefly, so a later call (after onboarding, after a change on
 * another device) reads fresh.
 */
const read = () =>
  supabase
    .from('app_settings')
    .select('timezone, onboarded_at, theme, look, today_order, today_hidden, modules_off, board')
    .limit(1);

type Result = Awaited<ReturnType<typeof read>>;
let pending: Promise<Result> | null = null;

export function startupSettings(): Promise<Result> {
  if (!pending) {
    // A real promise, not the query builder: awaiting a builder twice sends the request twice.
    pending = read().then((r) => r);
    setTimeout(() => (pending = null), 2000);
  }
  return pending;
}

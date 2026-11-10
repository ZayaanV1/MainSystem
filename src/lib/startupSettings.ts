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

let pending: ReturnType<typeof read> | null = null;

export function startupSettings(): ReturnType<typeof read> {
  if (!pending) {
    pending = read();
    setTimeout(() => (pending = null), 2000);
  }
  return pending;
}

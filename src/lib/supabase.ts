import { createClient } from '@supabase/supabase-js';

/**
 * The Supabase client.
 *
 * The anon key is public and ships in the browser bundle. That is expected and
 * safe: row level security is what protects the data, and every table has it
 * enabled with policies keyed to auth.uid(). The migration tests prove one
 * account cannot read or write another's rows.
 *
 * Sessions persist and auto-refresh, and are deliberately long-lived. Being
 * asked to sign in again is a small thing on a good day and a reason not to
 * open the app on a bad one.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * True once setup has run. The app checks this rather than crashing on a
 * missing key, so a fresh clone shows an instruction instead of a white
 * screen and a console error.
 */
export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

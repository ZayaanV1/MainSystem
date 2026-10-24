import { supabase } from './supabase';
import { clearCache } from './readcache';

/**
 * Things that are about the account itself rather than the planner's work:
 * its own AI keys, and leaving.
 *
 * Split out of planner.ts, which had grown to hold the types, every read and
 * write of the work, series, settings, and these. They have nothing in common
 * with a due date, and a change to how a key is stored should not mean reading
 * sixteen hundred lines about assignments.
 */

/**
 * Whether this account has its own Gemini key, without ever reading it back.
 *
 * The key is write-only from the app's point of view. There is no reason to
 * pull a secret into the browser to render a row that only needs to say
 * "set" or "not set", and a value that is never fetched cannot leak from a
 * screenshot, a bug report or a stray log.
 */
export async function hasOwnApiKey(): Promise<boolean> {
  return (await ownKeyStatus()).gemini;
}

/**
 * Whether each key is set — the only question the app asks about them.
 *
 * This used to select the key columns themselves, so the raw keys reached the
 * browser on every Settings open while the copy promised they never would.
 * The columns are no longer readable by the account at all (migration 0034);
 * a function answers yes or no.
 */
async function ownKeyStatus(): Promise<{ gemini: boolean; groq: boolean }> {
  const { data } = await supabase.rpc('own_key_status');
  const row = (Array.isArray(data) ? data[0] : data) as { gemini?: boolean; groq?: boolean } | null;
  return { gemini: Boolean(row?.gemini), groq: Boolean(row?.groq) };
}

/** Sets or clears it. Passing null goes back to the shared key. */
export async function setOwnApiKey(
  userId: string,
  key: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('app_settings')
    .update({ gemini_api_key: key && key.trim() ? key.trim() : null })
    .eq('user_id', userId);

  return { error: error ? error.message : null };
}


/**
 * Deletes this account and everything in it.
 *
 * Irreversible, and there is no soft-delete hiding behind it — the twenty-one
 * foreign keys to auth.users cascade, so the row going means the data goes.
 * A planner that claims to delete and quietly retains is worse than one that
 * cannot delete at all, because the claim is the thing people rely on.
 *
 * The cache is cleared first for the same reason it is on sign-out: a device
 * still holding the last-seen day of a deleted account is exactly the copy
 * this action promised to remove.
 */
export async function deleteAccount(): Promise<{ error: string | null }> {
  await clearCache();

  // Photos on the board are files, not rows: the cascade cannot reach them.
  const { data: who } = await supabase.auth.getUser();
  if (who.user) {
    const [{ removeAllPhotos }, { removeAllWorkFiles }] = await Promise.all([import('./boardPhotos'), import('./workFiles')]);
    // Both must succeed. The account is deleted after this, and files left in
    // storage afterwards belong to nobody who could remove them.
    const cleared = await Promise.all([removeAllPhotos(who.user.id), removeAllWorkFiles().catch(() => false)]);
    if (cleared.includes(false)) {
      return { error: 'Your files couldn’t be removed, so the account was not deleted. Check the connection and try again.' };
    }
  }

  const { error } = await supabase.rpc('delete_own_account');
  if (error) return { error: error.message };

  // The session now references a user that no longer exists. Ending it locally
  // stops the app from spending the next minute retrying queries as a ghost.
  await supabase.auth.signOut();
  return { error: null };
}

/**
 * Whether this account has its own Groq key.
 *
 * Same write-only contract as the Gemini one: the app asks WHETHER a key is
 * set and never reads the value back, so it cannot leak from a screenshot, a
 * bug report or a stray log.
 *
 * A separate column rather than a shared "api key" because the two providers
 * are not interchangeable — Groq's chat models take no documents, so the
 * syllabus reader stays on Gemini whatever is set here.
 */
export async function hasOwnGroqKey(): Promise<boolean> {
  return (await ownKeyStatus()).groq;
}

/** Sets or clears it. Passing null returns the chatbot to the shared key. */
export async function setOwnGroqKey(
  userId: string,
  key: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('app_settings')
    .update({ groq_api_key: key && key.trim() ? key.trim() : null })
    .eq('user_id', userId);

  return { error: error ? error.message : null };
}

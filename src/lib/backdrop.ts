import { supabase } from './supabase';
import { photoUrl, removePhotos, uploadPhoto } from './boardPhotos';

/**
 * The room behind Vision: the bundled dusk photo, or the account's own.
 *
 * Per account (app_settings.backdrop, migration 0048), like the theme it
 * belongs to, so the phone and the laptop sit in the same room. The photo
 * lives in the board's private bucket, in the account's own folder, so the
 * same access rule covers it and account deletion removes it with the rest.
 */

const VAR = '--vision-photo';
let refresh: ReturnType<typeof setTimeout> | null = null;

export async function loadBackdrop(): Promise<string | null> {
  const { data, error } = await supabase.from('app_settings').select('backdrop').limit(1);
  if (error) return null;
  return ((data?.[0] as { backdrop?: string | null } | undefined)?.backdrop ?? null) || null;
}

/**
 * Show a photo behind the app, or the bundled one for null. Signed addresses
 * last an hour, so the address is renewed while the app stays open.
 */
export async function showBackdrop(path: string | null): Promise<void> {
  if (refresh) clearTimeout(refresh);
  const root = document.documentElement;
  if (!path) {
    root.style.removeProperty(VAR);
    return;
  }
  const url = await photoUrl(path);
  if (url) root.style.setProperty(VAR, `url("${url}")`);
  refresh = setTimeout(() => void showBackdrop(path), 45 * 60_000);
}

export async function setBackdrop(
  userId: string,
  file: Blob,
  previous: string | null,
): Promise<{ path: string | null; error: string | null }> {
  const { path, error } = await uploadPhoto(userId, file);
  if (error || !path) return { path: null, error: error ?? 'Couldn’t upload the photo. Try again.' };
  const { error: saveError } = await supabase.from('app_settings').update({ backdrop: path }).eq('user_id', userId);
  if (saveError) {
    await removePhotos([path]);
    return { path: null, error: 'Couldn’t save the background. Try again.' };
  }
  if (previous) await removePhotos([previous]);
  await showBackdrop(path);
  return { path, error: null };
}

export async function clearBackdrop(userId: string, previous: string | null): Promise<{ error: string | null }> {
  const { error } = await supabase.from('app_settings').update({ backdrop: null }).eq('user_id', userId);
  if (error) return { error: 'Couldn’t go back to the default. Try again.' };
  if (previous) await removePhotos([previous]);
  await showBackdrop(null);
  return { error: null };
}

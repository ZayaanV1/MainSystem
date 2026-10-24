import { supabase } from './supabase';

/**
 * Photos on the widget board, in the private `board-photos` bucket
 * (migration 0040), one folder per account named by its id.
 *
 * Spoken to over Storage's REST API rather than through supabase-js, because
 * the bundle stubs `@supabase/storage-js` out (see tests/vendor.test.ts): the
 * first screen cannot afford it, and these three calls are all a board needs.
 * This module is only reached from the board's own chunk and from account
 * deletion.
 *
 * A photo is shrunk on the phone to 1200 px on its long side before it is
 * sent, so a board's six photos cost about a megabyte of the free tier's one
 * shared gigabyte rather than whatever the camera produced.
 */

const BUCKET = 'board-photos';
const base = `${import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost'}/storage/v1`;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'anon';

async function headers(extra: Record<string, string> = {}): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, apikey: anonKey, ...extra };
}

const LONG_SIDE = 1200;

/** The picture as a JPEG no longer than LONG_SIDE on either side. */
export async function shrinkImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.82),
  );
}

/** Upload a photo into the account's folder. Returns its path. */
export async function uploadPhoto(userId: string, file: Blob): Promise<{ path: string | null; error: string | null }> {
  let body: Blob;
  try {
    body = await shrinkImage(file);
  } catch {
    return { path: null, error: 'That file couldn’t be read as a picture. Try a JPEG or PNG.' };
  }
  const h = await headers({ 'Content-Type': 'image/jpeg' });
  if (!h) return { path: null, error: 'You’re signed out. Sign in again to add a photo.' };
  const path = `${userId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
  try {
    const res = await fetch(`${base}/object/${BUCKET}/${path}`, { method: 'POST', headers: h, body });
    if (!res.ok) return { path: null, error: 'Couldn’t upload the photo. Check the connection and try again.' };
  } catch {
    return { path: null, error: 'Couldn’t upload the photo. Check the connection and try again.' };
  }
  return { path, error: null };
}

const signed = new Map<string, { url: string; until: number }>();

/** A short-lived address for one of the account's photos, cached until near its expiry. */
export async function photoUrl(path: string): Promise<string | null> {
  const hit = signed.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const h = await headers({ 'Content-Type': 'application/json' });
  if (!h) return null;
  try {
    const res = await fetch(`${base}/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!res.ok) return null;
    const { signedURL } = (await res.json()) as { signedURL?: string };
    if (!signedURL) return null;
    const url = `${base}${signedURL}`;
    signed.set(path, { url, until: Date.now() + 50 * 60_000 });
    return url;
  } catch {
    return null;
  }
}

/** Remove photos by path. Quiet on failure: an orphaned photo is unreadable by anyone else. */
export async function removePhotos(paths: string[]): Promise<void> {
  await removeKeys(paths);
}

/** Whether every path was removed. */
async function removeKeys(paths: string[]): Promise<boolean> {
  if (!paths.length) return true;
  const h = await headers({ 'Content-Type': 'application/json' });
  if (!h) return false;
  paths.forEach((p) => signed.delete(p));
  try {
    const res = await fetch(`${base}/object/${BUCKET}`, { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes: paths }) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Every photo in the account's folder, removed, and whether that worked.
 *
 * Called before the account is deleted: storage objects are not rows with a
 * foreign key to the account, so the cascade that removes everything else
 * cannot reach them. The answer matters. Deleting the account after a failed
 * removal would leave the photos in storage with nobody able to reach or
 * remove them, so the caller stops instead.
 */
export async function removeAllPhotos(userId: string): Promise<boolean> {
  const h = await headers({ 'Content-Type': 'application/json' });
  if (!h) return false;
  try {
    // Pages of 100 until the folder is empty, so a full board is not left half there.
    for (let page = 0; page < 20; page++) {
      const res = await fetch(`${base}/object/list/${BUCKET}`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ prefix: userId, limit: 100 }),
      });
      if (!res.ok) return false;
      const items = (await res.json()) as { name: string }[];
      if (items.length === 0) return true;
      if (!(await removeKeys(items.map((i) => `${userId}/${i.name}`)))) return false;
    }
    return false;
  } catch {
    return false;
  }
}

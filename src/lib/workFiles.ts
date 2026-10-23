import { supabase } from './supabase';
import { isGuide, type Guide } from '../../supabase/functions/_shared/guide';

/**
 * PDFs attached to a piece of work, in the private `work-files` bucket
 * (migration 0043) under <account>/<work>/<random>.pdf.
 *
 * Spoken to over Storage's REST API for the same reason as the board's photos
 * (lib/boardPhotos.ts): the bundle stubs storage-js out to keep the first
 * screen small, and four calls are all this needs. Only reached from the work
 * page's own chunk, plus deleting work and deleting an account.
 *
 * Files are online-only by design. A queued upload of ten megabytes in the
 * offline outbox is a good way to fill a phone and lose track of it; instead
 * the failure is stated at the moment it happens, with the file still in hand.
 */

const BUCKET = 'work-files';
const base = `${import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost'}/storage/v1`;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'anon';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_WORK = 3;

export interface WorkFile {
  id: string;
  assignment_id: string;
  name: string;
  path: string;
  size_bytes: number;
  guide: Guide | null;
  guide_at: string | null;
  created_at: string;
}

const COLUMNS = 'id, assignment_id, name, path, size_bytes, guide, guide_at, created_at';

async function headers(extra: Record<string, string> = {}): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, apikey: anonKey, ...extra };
}

/** A stored guide that this version cannot show is treated as no guide, never as a crash. */
function shaped(row: Record<string, unknown>): WorkFile {
  return { ...(row as unknown as WorkFile), guide: isGuide(row.guide) ? row.guide : null };
}

export async function loadFiles(assignmentId: string): Promise<{ files: WorkFile[]; failed: boolean }> {
  const { data, error } = await supabase
    .from('assignment_files')
    .select(COLUMNS)
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: true });
  if (error) return { files: [], failed: true };
  return { files: (data ?? []).map((r) => shaped(r as Record<string, unknown>)), failed: false };
}

/** Whether a file is something this can store: a PDF, within the size the bucket allows. */
export function checkFile(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return 'Only PDF files can be attached.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_FILE_BYTES) return 'That file is over 10 MB. Try a smaller copy.';
  return null;
}

/** The name shown in the list: the file's own, without the extension. */
export function displayName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 200) || 'Brief';
}

/**
 * Upload a PDF and record it. The object goes first and the row second; if the
 * row is refused (the cap, a signed-out session) the object is taken back out
 * so a failed attach leaves nothing behind.
 */
export async function attachFile(
  userId: string,
  assignmentId: string,
  file: File,
): Promise<{ file: WorkFile | null; error: string | null }> {
  const problem = checkFile(file);
  if (problem) return { file: null, error: problem };
  const h = await headers({ 'Content-Type': 'application/pdf', 'x-upsert': 'false' });
  if (!h) return { file: null, error: 'You’re signed out. Sign in again to attach a file.' };

  const path = `${userId}/${assignmentId}/${crypto.randomUUID()}.pdf`;
  try {
    const res = await fetch(`${base}/object/${BUCKET}/${path}`, { method: 'POST', headers: h, body: file });
    if (!res.ok) return { file: null, error: 'Couldn’t upload that file. Check the connection and try again.' };
  } catch {
    return { file: null, error: 'Couldn’t upload that file. Check the connection and try again.' };
  }

  const { data, error } = await supabase
    .from('assignment_files')
    .insert({ user_id: userId, assignment_id: assignmentId, name: displayName(file.name), path, size_bytes: file.size })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    await removeObjects([path]);
    const capped = /three files|thirty files/i.test(error?.message ?? '');
    return {
      file: null,
      error: capped
        ? `A piece of work holds ${MAX_FILES_PER_WORK} files at most, and an account thirty. Remove one first.`
        : 'The file uploaded but couldn’t be saved, so it was removed. Try again.',
    };
  }
  return { file: shaped(data as Record<string, unknown>), error: null };
}

/** Save (or clear, with null) the guide against its file. Only called once the person has accepted it. */
export async function saveGuide(id: string, guide: Guide | null): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('assignment_files')
    .update({ guide, guide_at: guide ? new Date().toISOString() : null })
    .eq('id', id);
  return { error: error ? 'Couldn’t save the guide. It is still on screen; try again.' : null };
}

async function removeObjects(paths: string[]): Promise<boolean> {
  if (!paths.length) return true;
  const h = await headers({ 'Content-Type': 'application/json' });
  if (!h) return false;
  paths.forEach((p) => urls.delete(p));
  try {
    const res = await fetch(`${base}/object/${BUCKET}`, { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes: paths }) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Remove one file: the object, then the row. The row stays if the object could not go. */
export async function removeFile(file: WorkFile): Promise<{ error: string | null }> {
  if (!(await removeObjects([file.path]))) return { error: 'Couldn’t remove that file. Check the connection and try again.' };
  const { error } = await supabase.from('assignment_files').delete().eq('id', file.id);
  return { error: error ? 'The file was removed but its entry wasn’t. Reload and try again.' : null };
}

/**
 * Every file of one piece of work, before the work itself is deleted. Quiet on
 * failure: an object orphaned by an offline delete is readable by nobody else.
 */
export async function removeFilesFor(assignmentId: string): Promise<void> {
  const { data } = await supabase.from('assignment_files').select('path').eq('assignment_id', assignmentId);
  await removeObjects((data ?? []).map((r) => r.path as string));
}

/** Every file in the account, before the account is deleted: storage is not reached by the cascade. */
export async function removeAllWorkFiles(): Promise<void> {
  const { data } = await supabase.from('assignment_files').select('path');
  await removeObjects((data ?? []).map((r) => r.path as string));
}

const urls = new Map<string, { url: string; until: number }>();

/** A short-lived address for one file, cached until near its expiry. */
export async function fileUrl(path: string): Promise<string | null> {
  const hit = urls.get(path);
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
    urls.set(path, { url, until: Date.now() + 50 * 60_000 });
    return url;
  } catch {
    return null;
  }
}

/** The file's bytes, for the viewer and for export. */
export async function fetchBytes(path: string): Promise<ArrayBuffer | null> {
  const url = await fileUrl(path);
  if (!url) return null;
  try {
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

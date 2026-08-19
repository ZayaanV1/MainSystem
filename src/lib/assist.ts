import { supabase } from './supabase';
import type { BreakdownStep } from '../../supabase/functions/_shared/breakdown';
import type { SyllabusItem } from '../../supabase/functions/_shared/syllabus';

/**
 * Client for the assist edge function.
 *
 * Both tasks return a proposal and write nothing, so everything here is
 * read-only by construction. Failures resolve rather than throw, and every one
 * carries a sentence that ends in something the person can still do.
 */

export interface BreakdownResponse {
  ok: true;
  steps: BreakdownStep[];
  warnings: string[];
}

export interface SyllabusResponse {
  ok: true;
  items: SyllabusItem[];
  warnings: string[];
}

export interface AssistFailure {
  ok: false;
  reason: string;
}

async function call(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, reason: 'You are signed out. Sign in and try again.' };

  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assist`, {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const raw = (e as Error).message;
    return {
      ok: false,
      reason: /load failed|failed to fetch|networkerror/i.test(raw)
        ? "Couldn't reach the server. Try again, or add them by hand."
        : `Couldn't reach the server. ${raw}`,
    };
  }

  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'The server returned something unreadable. Nothing was saved.' };
  }
}

const failureOf = (body: Record<string, unknown>): AssistFailure => ({
  ok: false,
  reason:
    typeof body.reason === 'string'
      ? body.reason
      : typeof body.error === 'string'
        ? `${body.error}.`
        : 'That is unavailable right now. Add them by hand.',
});

export async function breakDownTask(input: {
  title: string;
  courseName?: string | null;
  notes?: string | null;
}): Promise<BreakdownResponse | AssistFailure> {
  const body = await call({
    task: 'breakdown',
    title: input.title,
    courseName: input.courseName ?? undefined,
    notes: input.notes ?? undefined,
  });

  if (body.ok !== true) return failureOf(body);

  return {
    ok: true,
    steps: (body.steps ?? []) as BreakdownStep[],
    warnings: (body.warnings ?? []) as string[],
  };
}

export async function readSyllabus(input: {
  text?: string;
  pdf?: { data: string; mimeType: string };
  termFrom?: string;
  termTo?: string;
}): Promise<SyllabusResponse | AssistFailure> {
  const body = await call({ task: 'syllabus', ...input });

  if (body.ok !== true) return failureOf(body);

  return {
    ok: true,
    items: (body.items ?? []) as SyllabusItem[],
    warnings: (body.warnings ?? []) as string[],
  };
}

/**
 * Reads a file as base64 for the syllabus request.
 *
 * Resolves to null rather than throwing: a file that will not read is not
 * worth an error dialog when pasting the text is right there.
 */
export function readFile(file: File): Promise<{ data: string; mimeType: string } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? null : { data: result.slice(comma + 1), mimeType: file.type });
    };
    reader.readAsDataURL(file);
  });
}

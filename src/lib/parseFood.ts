import { supabase } from './supabase';
import type { ParsedFoodItem, ParseWarning } from '../../supabase/functions/_shared/food';

/**
 * Client for the parse-food edge function.
 *
 * The function returns a parse and never writes it, so everything here is
 * read-only by construction. Nothing in this file touches the food log.
 *
 * Every failure path resolves rather than throws, and every failure carries a
 * sentence saying what to do next. The parser shares one free-tier quota with
 * the chatbot, so being out of requests is a normal Tuesday — and the answer
 * is always "type it in", which has to be offered rather than implied.
 */

export interface ParseSuccess {
  ok: true;
  items: ParsedFoodItem[];
  warnings: ParseWarning[];
  raw_text: string | null;
  provider: string;
}

export interface ParseFailure {
  ok: false;
  /** Already written for a person to read. Shown verbatim. */
  reason: string;
}

export type ParseResponse = ParseSuccess | ParseFailure;

export interface ParseInput {
  text?: string;
  image?: { data: string; mimeType: string };
}

export async function parseFood(input: ParseInput): Promise<ParseResponse> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, reason: 'You are signed out. Sign in and try again.' };

  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-food`, {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  } catch (e) {
    // Safari reports every blocked or failed request as "Load failed", which
    // tells you nothing useful. Say the one thing that is always true instead.
    const raw = (e as Error).message;
    return {
      ok: false,
      reason: /load failed|failed to fetch|networkerror/i.test(raw)
        ? "Couldn't reach the parser. Add the items by hand, or try again."
        : `Couldn't reach the parser. ${raw}`,
    };
  }

  let body: Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'The parser returned something unreadable. Add the items by hand.' };
  }

  if (body.ok === true) {
    return {
      ok: true,
      items: (body.items ?? []) as ParsedFoodItem[],
      warnings: (body.warnings ?? []) as ParseWarning[],
      raw_text: (body.raw_text ?? null) as string | null,
      provider: String(body.provider ?? 'unknown'),
    };
  }

  // The function writes the person-facing sentence itself, so both the
  // model-failure and HTTP-error paths land on the same copy.
  const reason =
    typeof body.reason === 'string'
      ? body.reason
      : typeof body.error === 'string'
        ? `${body.error}. Add the items by hand.`
        : `Parsing failed (HTTP ${res.status}). Add the items by hand.`;

  return { ok: false, reason };
}

/**
 * Reads an image file as base64 for the parse request.
 *
 * Resolves to null rather than throwing, because a photo that will not read is
 * not worth an error dialog — the text box is right there.
 */
export function readImage(file: File): Promise<{ data: string; mimeType: string } | null> {
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

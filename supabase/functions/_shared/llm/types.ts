/**
 * The LLM boundary.
 *
 * One interface, shared by the diet parser and the Phase 5 chatbot. The
 * provider is a detail: swapping Gemini for Groq should be a new file
 * implementing this and a changed environment variable, never a change to a
 * caller.
 *
 * Two things are deliberately part of the contract rather than left to each
 * provider:
 *
 *   Structured output is required, not requested. A model that returns prose
 *   where JSON was expected is a failure, not something to parse heuristically.
 *
 *   Quota exhaustion is a named outcome, not an exception. The diet parser and
 *   the chatbot share one free-tier quota, and the app has to say "the parser
 *   is out of requests until tomorrow, type it in by hand" rather than
 *   presenting a generic error or, worse, silently doing nothing.
 */

export type LlmFailure =
  /** Out of free-tier requests. Recoverable tomorrow, or by typing it in. */
  | 'quota'
  /** The model replied, but not with the shape that was demanded. */
  | 'malformed'
  /** No key configured. */
  | 'unconfigured'
  /** Network, timeout, provider outage. */
  | 'unavailable'
  /** The provider declined to answer. */
  | 'refused';

export type LlmResult<T> =
  | { ok: true; value: T; provider: string }
  | { ok: false; failure: LlmFailure; message: string; provider: string };

export interface LlmImage {
  /** Base64 without the data: prefix. */
  data: string;
  mimeType: string;
}

export interface LlmRequest {
  /** What the model is for. Kept short; the schema carries most of the shape. */
  instruction: string;
  input: string;
  images?: LlmImage[];
  /** JSON Schema the reply must satisfy. Enforced by the provider. */
  schema: Record<string, unknown>;
  /** Low for extraction, higher only where invention is the point. */
  temperature?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly configured: boolean;
  complete<T>(request: LlmRequest): Promise<LlmResult<T>>;
}

import type { LlmFailure, LlmProvider, LlmRequest, LlmResult } from './types.ts';

/**
 * A provider that falls back to a second one.
 *
 * The chatbot runs on Groq when a key exists and on Gemini otherwise — and
 * until now a Groq failure was the end of the question, even with a working
 * Gemini key sitting right beside it. When Groq's catalogue moved and the
 * model the app asked for was withdrawn, every question failed, although the
 * app could have answered all of them.
 *
 * Only failures of the PROVIDER fall through. A refusal is an answer about
 * the question and asking elsewhere would be shopping for a different one;
 * running out of quota is governed by the budget the caller already applied,
 * and quietly spending a shared pool because a private one ran dry would
 * defeat it.
 */
const FALL_THROUGH: LlmFailure[] = ['retired', 'unavailable', 'malformed', 'unconfigured'];

export function withFallback(primary: LlmProvider, secondary: LlmProvider): LlmProvider {
  return {
    name: `${primary.name}+${secondary.name}`,
    configured: primary.configured || secondary.configured,

    async complete<T>(request: LlmRequest): Promise<LlmResult<T>> {
      const first = await primary.complete<T>(request);
      if (first.ok || !FALL_THROUGH.includes(first.failure) || !secondary.configured) return first;

      const second = await secondary.complete<T>(request);
      if (second.ok) return { ...second, provider: `${second.provider} (after ${primary.name}: ${first.failure})` };

      // Both failed. Report the first — it is the one that was meant to answer
      // — with the second's reason attached, so neither is hidden.
      return { ...first, message: `${first.message} Then ${second.provider}: ${second.message}`.slice(0, 400) };
    },
  };
}

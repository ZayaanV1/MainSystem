import type { LlmProvider, LlmRequest } from './types.ts';

/**
 * A model that runs somewhere else: the account's own Mac, through Claude Code
 * on the account's own Claude subscription (bridge/imessage, Nov 2026).
 *
 * The server cannot call it, so the conversation is replayed. Each pass runs
 * askAbood from the top with the answers the Mac has given so far; the first
 * call past them stops the pass with NeedModel, carrying the exact request,
 * and the bridge comes back with one more answer. Everything else (the
 * context, id checks, the yes before a change, the scripted rewrite) runs on
 * the server exactly as it does for every other model.
 */
export class NeedModel extends Error {
  constructor(readonly request: LlmRequest) {
    super('the model runs on the bridge');
  }
}

export function relayProvider(answers: unknown[]): LlmProvider {
  let next = 0;
  return {
    name: 'claude',
    configured: true,
    // deno-lint-ignore require-await
    async complete<T>(request: LlmRequest) {
      if (next < answers.length) return { ok: true as const, value: answers[next++] as T, provider: 'claude' };
      throw new NeedModel(request);
    },
  };
}

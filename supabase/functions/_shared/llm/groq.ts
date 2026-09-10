import type { LlmFailure, LlmProvider, LlmRequest, LlmResult } from './types.ts';

/**
 * Groq, for the chatbot.
 *
 * The LlmProvider docstring named Groq as the case the interface was built
 * for, so this is the extension point being used as designed: a new file and
 * a changed setting, with no caller touched.
 *
 * WHY ONLY THE CHATBOT
 *
 * Groq's chat models are text-only. The diet parser sends photographs — a
 * plate of food, a nutrition label — and a provider that silently dropped the
 * image would answer confidently about a meal it never saw, which is the worst
 * available failure on that path. So food parsing stays on Gemini and the
 * chatbot moves here, and the choice is made per TASK rather than globally.
 *
 * That split is also the right one on cost. Chat is the high-volume,
 * conversational, latency-sensitive path and Groq is very fast and free at
 * this scale; parsing is lower volume and genuinely needs vision.
 *
 * THE API IS OPENAI-SHAPED
 *
 * Groq serves an OpenAI-compatible endpoint, which is why this file is short.
 * The only real work is translating the app's JSON Schema requirement into
 * `response_format` and mapping HTTP statuses onto the app's named failures.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * The default model, overridable by environment.
 *
 * Named in one place and configurable, because this project has already been
 * bitten once by a hardcoded model name retiring underneath it: a 404 surfaced
 * as "could not reach the model", which is advice to retry for a fault that
 * retrying cannot fix.
 */
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

function classify(status: number, body: string): LlmFailure {
  // Rate limited or out of daily tokens. Recoverable by waiting, which is
  // what the app tells the user.
  if (status === 429) return 'quota';

  // A model that no longer exists for this key. Distinct from unavailable
  // because retrying is useless — it needs a changed setting.
  if (status === 404 || /model.*(not found|decommissioned|does not exist)/i.test(body)) {
    return 'retired';
  }

  if (status === 401 || status === 403) return 'unconfigured';
  if (status === 400 && /content|policy|safety/i.test(body)) return 'refused';
  return 'unavailable';
}

export function groqProvider(apiKey: string, model = DEFAULT_MODEL): LlmProvider {
  return {
    name: 'groq',
    configured: Boolean(apiKey),

    async complete<T>(request: LlmRequest): Promise<LlmResult<T>> {
      if (!apiKey) {
        return {
          ok: false,
          failure: 'unconfigured',
          message: 'No Groq key is set.',
          provider: 'groq',
        };
      }

      /*
       * An image request must FAIL rather than be sent without its images.
       * Dropping them would produce a confident answer about a photo the model
       * never received, which is exactly the confidently-wrong failure the
       * spec calls worse than no answer at all. The caller is expected to
       * route vision work to a provider that has it.
       */
      if (request.images && request.images.length > 0) {
        return {
          ok: false,
          failure: 'unavailable',
          message: 'This provider does not accept images. Use the vision provider for photos.',
          provider: 'groq',
        };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000);

      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            temperature: request.temperature ?? 0,
            messages: [
              { role: 'system', content: request.instruction },
              { role: 'user', content: request.input },
            ],
            /*
             * Structured output is part of the contract, not a request. The
             * app's callers validate the shape again on their own side, but a
             * provider that returns prose where JSON was demanded is a failure
             * rather than something to parse heuristically.
             */
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'reply',
                strict: true,
                schema: request.schema,
              },
            },
          }),
        });

        const raw = await res.text();

        if (!res.ok) {
          const failure = classify(res.status, raw);
          const message =
            failure === 'retired'
              ? `The model "${model}" is not available for this key. Set GROQ_MODEL to a current one.`
              : `Groq returned ${res.status}.`;
          return { ok: false, failure, message, provider: 'groq' };
        }

        let content: string;
        try {
          const body = JSON.parse(raw) as {
            choices?: { message?: { content?: string }; finish_reason?: string }[];
          };
          const choice = body.choices?.[0];

          // Ran out of room mid-object. The JSON will not parse and the
          // reason is worth distinguishing from a model that rambled.
          if (choice?.finish_reason === 'length') {
            return {
              ok: false,
              failure: 'malformed',
              message: 'The reply was cut off before it was complete.',
              provider: 'groq',
            };
          }

          content = choice?.message?.content ?? '';
        } catch {
          return {
            ok: false,
            failure: 'malformed',
            message: 'The provider’s envelope was not JSON.',
            provider: 'groq',
          };
        }

        if (!content.trim()) {
          return {
            ok: false,
            failure: 'malformed',
            message: 'The reply was empty.',
            provider: 'groq',
          };
        }

        try {
          return { ok: true, value: JSON.parse(content) as T, provider: 'groq' };
        } catch {
          // Demanded JSON, got something else. Guessing at the shape is how
          // malformed data reaches the database wearing a confirmation screen.
          return {
            ok: false,
            failure: 'malformed',
            message: 'The reply was not the JSON that was demanded.',
            provider: 'groq',
          };
        }
      } catch (e) {
        const aborted = e instanceof Error && e.name === 'AbortError';
        return {
          ok: false,
          failure: 'unavailable',
          message: aborted ? 'The provider did not answer in time.' : String(e),
          provider: 'groq',
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

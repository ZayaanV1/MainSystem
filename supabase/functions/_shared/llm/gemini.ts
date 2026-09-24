import type { LlmFailure, LlmProvider, LlmRequest, LlmResult } from './types.ts';

/**
 * Gemini, behind the shared interface.
 *
 * Uses responseSchema so the model is constrained at the provider rather than
 * asked politely in a prompt and checked afterwards. That is the difference
 * between "usually returns JSON" and "returns JSON".
 *
 * A note that belongs in the code rather than only in a conversation: on the
 * free tier Google may use submitted content to improve its products. What
 * gets sent here is food descriptions and, with photo logging, pictures of
 * meals. That was an accepted trade, but it is the reason this file is one
 * implementation of an interface rather than the interface itself — moving to
 * Groq or a paid tier should cost one file.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Flash rather than Pro. Extraction from a short string does not need the
 * larger model, and the free tier's request budget is shared with the chatbot.
 *
 * Settable, because Google retires model names on its own schedule and a
 * hardcoded one turns into a dead parser with no way to fix it but a deploy.
 * `gemini-2.5-flash` was the original choice and stopped being issued to new
 * keys; the failure was a 404 reported as "could not reach the model", which
 * is the least useful thing it could have said.
 */
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash';

/** Enough for a short extraction. Long jobs pass their own. */
const DEFAULT_TIMEOUT_MS = 20_000;

function classify(status: number, body: string): LlmFailure {
  if (status === 429) return 'quota';
  // Google returns 400 with RESOURCE_EXHAUSTED in some quota cases.
  if (/RESOURCE_EXHAUSTED|quota/i.test(body)) return 'quota';
  if (status === 401 || status === 403) return 'unconfigured';
  // A key Google does not recognise comes back as a 400, not a 401. It was
  // read as "could not reach the model" — advice to retry, for a key that
  // will be rejected every time.
  if (/API key not valid|API_KEY_INVALID/i.test(body)) return 'unconfigured';
  if (/SAFETY|blocked/i.test(body)) return 'refused';
  if (status === 404) return 'retired';
  if (/is no longer available|not found|NOT_FOUND/i.test(body)) return 'retired';
  return 'unavailable';
}

/**
 * The models this key may actually call.
 *
 * Asked for only when a request 404s, so the dead end reports what would have
 * worked instead of leaving the name to be guessed. Failure here is silent on
 * purpose: this runs inside the handling of another error and must not replace
 * it with a worse one.
 */
async function availableModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(`${ENDPOINT}?pageSize=100`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Picks a replacement when the configured model has retired.
 *
 * `availableModels` already filters to models that support generateContent, so
 * everything here is a candidate that can actually answer. The preference
 * order is about cost and latency, not capability:
 *
 *   flash-lite, then flash — this app makes small, frequent, structured calls
 *   and the cheap tiers are what a shared free key survives on.
 *   pro last, because it works and is the wrong default for parsing a line of
 *   typed food.
 *
 * Previews and experimental builds are skipped. Falling back to something
 * explicitly labelled unstable is how an app that just recovered from one
 * retirement walks into the next.
 */
function bestReplacement(models: string[]): string | null {
  const stable = models.filter((m) => !/preview|exp|experimental/i.test(m));
  const pool = stable.length > 0 ? stable : models;

  const rank = (m: string) =>
    /flash-lite/i.test(m) ? 0 : /flash/i.test(m) ? 1 : /pro/i.test(m) ? 2 : 3;

  return [...pool].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export function geminiProvider(apiKey: string): LlmProvider {
  return {
    name: 'gemini',
    configured: Boolean(apiKey),

    async complete<T>(request: LlmRequest): Promise<LlmResult<T>> {
      if (!apiKey) {
        return {
          ok: false,
          failure: 'unconfigured',
          message: 'No Gemini API key is set.',
          provider: 'gemini',
        };
      }

      const parts: Record<string, unknown>[] = [{ text: request.input }];
      for (const image of request.images ?? []) {
        parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      /*
       * The call, against a NAMED model rather than the module constant, so
       * the retired path below can run it a second time with a replacement.
       * Everything about the request is identical between the two attempts —
       * only the model differs, which is the point.
       */
      const call = (model: string) =>
        fetch(`${ENDPOINT}/${model}:generateContent`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.instruction }] },
            contents: [{ role: 'user', parts }],
            generationConfig: {
              // Low by default: this is extraction, not invention.
              temperature: request.temperature ?? 0,
              responseMimeType: 'application/json',
              responseSchema: request.schema,
            },
          }),
        });

      let usedModel = MODEL;

      try {
        let res = await call(MODEL);
        let raw = await res.text();

        if (!res.ok) {
          const failure = classify(res.status, raw);
          let message = `HTTP ${res.status}: ${raw.slice(0, 300)}`;

          /*
           * An overloaded model (503, "experiencing high demand") takes the
           * same way out as a retired one: another current model on the same
           * key is usually free when the default is not, and one extra
           * request beats sending a person away from a feature that would
           * have worked a model over.
           */
          if (failure === 'retired' || res.status === 503) {
            /*
             * Recover rather than report.
             *
             * A retired model name took the whole app down: food parsing, the
             * syllabus importer, the briefing and the chatbot all returned
             * "set GEMINI_MODEL to a current model" — advice nobody can act on
             * from inside the app, for a fault the app could have fixed
             * itself. The model list was already being fetched here and the
             * result was thrown away one layer up, so the diagnostic that
             * existed never reached anyone.
             *
             * So: ask which models this key can call, pick a current one, and
             * try once more. Once — a loop here would turn one dead model into
             * a sequence of slow failures on a shared quota.
             */
            const models = await availableModels(apiKey);
            // Never the default itself: retired, it cannot answer; overloaded,
            // asking it a second time is the same request to the same queue.
            const replacement = bestReplacement(models.filter((m) => m !== MODEL));

            if (replacement) {
              const second = await call(replacement);
              if (second.ok) {
                // Fall through into the normal success path with the retry's
                // body. The parsing and validation below are identical, and
                // duplicating them for the recovery case is how the two copies
                // drift apart.
                res = second;
                raw = await second.text();
                usedModel = replacement;
              }
            }

            if (usedModel === MODEL && failure === 'retired') message = models.length
              ? `Model "${MODEL}" is unavailable and no replacement worked. This key can use: ${models.slice(0, 12).join(', ')}`
              : `Model "${MODEL}" is unavailable, and the model list could not be read.`;
          }

          if (usedModel === MODEL) {
            return { ok: false, failure, message, provider: 'gemini' };
          }
        }

        const body = JSON.parse(raw) as {
          candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        };

        const candidate = body.candidates?.[0];
        if (candidate?.finishReason === 'SAFETY') {
          return {
            ok: false,
            failure: 'refused',
            message: 'The model declined to answer.',
            provider: 'gemini',
          };
        }

        const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        if (!text.trim()) {
          return {
            ok: false,
            failure: 'malformed',
            message: 'The model returned nothing.',
            provider: 'gemini',
          };
        }

        try {
          return {
            ok: true,
            value: JSON.parse(text) as T,
            // Names the model that actually answered, so a recovery is visible
            // in a log rather than silent.
            provider: usedModel === MODEL ? 'gemini' : `gemini:${usedModel}`,
          };
        } catch {
          // Deliberately not repaired heuristically. A response that is not the
          // shape demanded is a failure — guessing at it is how malformed data
          // reaches a food log.
          return {
            ok: false,
            failure: 'malformed',
            message: `Expected JSON, got: ${text.slice(0, 200)}`,
            provider: 'gemini',
          };
        }
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        return {
          ok: false,
          failure: 'unavailable',
          message: aborted
            ? `The model took longer than ${Math.round((request.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s.`
            : (e as Error).message,
          provider: 'gemini',
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

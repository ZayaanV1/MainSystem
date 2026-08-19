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

const TIMEOUT_MS = 20_000;

function classify(status: number, body: string): LlmFailure {
  if (status === 429) return 'quota';
  // Google returns 400 with RESOURCE_EXHAUSTED in some quota cases.
  if (/RESOURCE_EXHAUSTED|quota/i.test(body)) return 'quota';
  if (status === 401 || status === 403) return 'unconfigured';
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
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
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

        const raw = await res.text();

        if (!res.ok) {
          const failure = classify(res.status, raw);
          let message = `HTTP ${res.status}: ${raw.slice(0, 300)}`;

          if (failure === 'retired') {
            const models = await availableModels(apiKey);
            message = models.length
              ? `Model "${MODEL}" is unavailable. This key can use: ${models.slice(0, 12).join(', ')}`
              : `Model "${MODEL}" is unavailable, and the model list could not be read.`;
          }

          return { ok: false, failure, message, provider: 'gemini' };
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
          return { ok: true, value: JSON.parse(text) as T, provider: 'gemini' };
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
          message: aborted ? 'The model took too long.' : (e as Error).message,
          provider: 'gemini',
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

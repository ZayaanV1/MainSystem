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
 */
const MODEL = 'gemini-2.5-flash';

const TIMEOUT_MS = 20_000;

function classify(status: number, body: string): LlmFailure {
  if (status === 429) return 'quota';
  // Google returns 400 with RESOURCE_EXHAUSTED in some quota cases.
  if (/RESOURCE_EXHAUSTED|quota/i.test(body)) return 'quota';
  if (status === 401 || status === 403) return 'unconfigured';
  if (/SAFETY|blocked/i.test(body)) return 'refused';
  return 'unavailable';
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
          return {
            ok: false,
            failure: classify(res.status, raw),
            message: `HTTP ${res.status}: ${raw.slice(0, 300)}`,
            provider: 'gemini',
          };
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

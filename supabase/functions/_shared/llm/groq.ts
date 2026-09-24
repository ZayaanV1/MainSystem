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
 * THE API IS OPENAI-SHAPED
 *
 * Groq serves an OpenAI-compatible endpoint. The real work is translating the
 * app's JSON Schema requirement into `response_format`, mapping HTTP statuses
 * onto the app's named failures — and surviving Groq's catalogue changing
 * underneath it, which it has.
 */

const BASE = 'https://api.groq.com/openai/v1';

/**
 * The model asked for first, overridable by environment.
 *
 * `llama-3.3-70b-versatile` was the original and stopped being served to this
 * account's key, which turned every question into "set GROQ_MODEL to a current
 * one" — advice nobody can follow from inside the app. So this is now only a
 * first guess: when it is gone the provider reads the catalogue and picks
 * again (see `bestReplacement`), and remembers the pick for the life of the
 * isolate so the recovery costs one extra request, not one per question.
 */
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** A replacement that worked, per key, so later questions go straight to it. */
const healed = new Map<string, string>();

interface GroqError {
  error?: { message?: string; code?: string; type?: string };
}

function errorOf(raw: string): { message: string; code: string } {
  try {
    const e = (JSON.parse(raw) as GroqError).error;
    return { message: e?.message ?? raw.slice(0, 200), code: e?.code ?? '' };
  } catch {
    return { message: raw.slice(0, 200), code: '' };
  }
}

export function classify(status: number, raw: string): LlmFailure {
  const { message, code } = errorOf(raw);
  // Rate limited or out of daily tokens. Recoverable by waiting.
  if (status === 429) return 'quota';

  // A model that no longer exists for this key. Distinct from unavailable
  // because retrying the same name is useless.
  if (
    status === 404 ||
    /model_(not_found|decommissioned|not_active|permission)/i.test(code) ||
    /model.*(not found|decommissioned|does not exist|not available|no longer)/i.test(message)
  ) {
    return 'retired';
  }

  if (status === 401 || status === 403) return 'unconfigured';
  if (status === 400 && /content|policy|safety/i.test(message)) return 'refused';
  return 'unavailable';
}

/**
 * The model took the request but not the strict schema — because it does not
 * do strict output at all, or because strict mode has rules the schema does
 * not meet. Either way the same model can still answer in JSON mode.
 */
export function schemaUnsupported(status: number, raw: string): boolean {
  if (status !== 400) return false;
  const { message } = errorOf(raw);
  return /json.?schema|response_format|structured output/i.test(message);
}

/**
 * The schema as strict mode wants it: every object closed with
 * `additionalProperties: false`.
 *
 * The app's schemas were written for Gemini, which does not ask for this, and
 * the first current Groq model found rejected the chatbot's schema on exactly
 * this rule. Closing every object changes nothing the app accepts — each
 * caller already validates the reply and drops keys it does not know.
 */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([name, sub]) => [name, strictSchema(sub)]),
      );
    } else {
      out[k] = strictSchema(v);
    }
  }
  const isObject = out.type === 'object' || (Array.isArray(out.type) && out.type.includes('object')) || 'properties' in out;
  if (isObject && !('additionalProperties' in out)) out.additionalProperties = false;
  return out;
}

/**
 * The best chat model in a catalogue, for this app's purposes.
 *
 * Ranked by what the chatbot needs: strict structured output and a sensible
 * size for short, frequent questions. Families known to honour json_schema
 * come first; speech, moderation and routing models are never candidates,
 * because they are not chat models at all. The order is a preference, not a
 * whitelist — an unknown new family still beats nothing.
 */
export function bestReplacement(models: { id: string; active?: boolean }[], exclude: string): string | null {
  const NOT_CHAT = /whisper|tts|playai|orpheus|guard|safeguard|distil|compound|embed|vision-only/i;
  const PREFERENCE = [
    /gpt-oss-120b/i,
    /gpt-oss-20b/i,
    /kimi-k2/i,
    /llama-4-maverick/i,
    /llama-4-scout/i,
    /qwen3/i,
    /llama-3\.3-70b/i,
    /llama/i,
  ];

  const pool = models
    .filter((m) => m.active !== false && m.id !== exclude && !NOT_CHAT.test(m.id))
    .map((m) => m.id);

  const rank = (id: string) => {
    const i = PREFERENCE.findIndex((re) => re.test(id));
    return i === -1 ? PREFERENCE.length : i;
  };

  return [...pool].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0] ?? null;
}

async function catalogue(apiKey: string): Promise<{ id: string; active?: boolean }[]> {
  try {
    const res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { id: string; active?: boolean }[] };
    return body.data ?? [];
  } catch {
    return [];
  }
}

export function groqProvider(apiKey: string, model = DEFAULT_MODEL): LlmProvider {
  return {
    name: 'groq',
    configured: Boolean(apiKey),

    async complete<T>(request: LlmRequest): Promise<LlmResult<T>> {
      if (!apiKey) {
        return { ok: false, failure: 'unconfigured', message: 'No Groq key is set.', provider: 'groq' };
      }

      /*
       * An image request must FAIL rather than be sent without its images.
       * Dropping them would produce a confident answer about a photo the model
       * never received — the confidently-wrong failure the spec calls worse
       * than no answer. The caller routes vision work elsewhere.
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

      /*
       * One request, parameterised by model and by how strictly the output
       * format is enforced. Strict json_schema is preferred; a model that
       * does not offer it gets JSON mode with the schema stated in the
       * instruction, and the caller's own validation still decides whether
       * the answer is usable.
       */
      const call = (m: string, strict: boolean) =>
        fetch(`${BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
          body: JSON.stringify({
            model: m,
            temperature: request.temperature ?? 0,
            messages: [
              {
                role: 'system',
                content: strict
                  ? request.instruction
                  : `${request.instruction}\n\nReply with a single JSON object that matches this JSON Schema exactly:\n${JSON.stringify(request.schema)}`,
              },
              { role: 'user', content: request.input },
            ],
            response_format: strict
              ? { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: strictSchema(request.schema) } }
              : { type: 'json_object' },
          }),
        });

      let used = healed.get(apiKey) ?? model;

      try {
        let res = await call(used, true);
        let raw = await res.text();

        // A model that is current but does not do strict schemas: same model,
        // JSON mode.
        if (!res.ok && schemaUnsupported(res.status, raw)) {
          res = await call(used, false);
          raw = await res.text();
        }

        if (!res.ok && classify(res.status, raw) === 'retired') {
          /*
           * Recover rather than report. Read which models this key can call,
           * pick the best current one and try once more — once, because a
           * loop would turn one dead name into a string of slow failures.
           */
          const replacement = bestReplacement(await catalogue(apiKey), used);
          if (replacement) {
            let second = await call(replacement, true);
            let secondRaw = await second.text();
            if (!second.ok && schemaUnsupported(second.status, secondRaw)) {
              second = await call(replacement, false);
              secondRaw = await second.text();
            }
            if (second.ok) {
              healed.set(apiKey, replacement);
              used = replacement;
            }
            res = second;
            raw = secondRaw;
          }
        }

        if (!res.ok) {
          const failure = classify(res.status, raw);
          const { message } = errorOf(raw);
          return {
            ok: false,
            failure,
            // The provider's own words, so a failure that recovery could not
            // fix says what actually went wrong rather than a stock line.
            message: `Groq (${used}): ${message}`.slice(0, 280),
            provider: 'groq',
          };
        }

        let content: string;
        try {
          const body = JSON.parse(raw) as {
            choices?: { message?: { content?: string }; finish_reason?: string }[];
          };
          const choice = body.choices?.[0];

          // Ran out of room mid-object. Worth distinguishing from a model
          // that rambled.
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
          return { ok: false, failure: 'malformed', message: 'The provider’s envelope was not JSON.', provider: 'groq' };
        }

        if (!content.trim()) {
          return { ok: false, failure: 'malformed', message: 'The reply was empty.', provider: 'groq' };
        }

        try {
          return {
            ok: true,
            value: JSON.parse(content) as T,
            // Names the model that answered when it was not the first choice,
            // so a recovery is visible in a log rather than silent.
            provider: used === model ? 'groq' : `groq:${used}`,
          };
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

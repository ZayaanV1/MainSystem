import { describe, it, expect } from 'vitest';
import { bestReplacement, classify, schemaUnsupported } from '../../supabase/functions/_shared/llm/groq';
import { withFallback } from '../../supabase/functions/_shared/llm/chain';
import type { LlmProvider, LlmResult } from '../../supabase/functions/_shared/llm/types';

const err = (message: string, code = '') => JSON.stringify({ error: { message, code, type: 'invalid_request_error' } });

describe('Groq failures', () => {
  it('reads a withdrawn model as retired, however Groq phrases it', () => {
    expect(classify(404, err('The model `llama-3.3-70b-versatile` does not exist', 'model_not_found'))).toBe('retired');
    expect(classify(400, err('The model `llama-3.3-70b-versatile` has been decommissioned', 'model_decommissioned'))).toBe('retired');
    expect(classify(400, err('model is not available for this key'))).toBe('retired');
  });

  it('keeps quota, auth and outages apart from retirement', () => {
    expect(classify(429, err('Rate limit reached'))).toBe('quota');
    expect(classify(401, err('Invalid API Key', 'invalid_api_key'))).toBe('unconfigured');
    expect(classify(503, 'upstream error')).toBe('unavailable');
  });

  it('notices a model that is current but refuses strict schemas', () => {
    expect(schemaUnsupported(400, err('This model does not support response format `json_schema`'))).toBe(true);
    expect(schemaUnsupported(400, err('messages must not be empty'))).toBe(false);
    expect(schemaUnsupported(500, err('json_schema not supported'))).toBe(false);
  });
});

describe('picking a replacement from the catalogue', () => {
  const catalogue = [
    { id: 'whisper-large-v3' },
    { id: 'meta-llama/llama-guard-4-12b' },
    { id: 'llama-3.1-8b-instant' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    { id: 'openai/gpt-oss-20b' },
    { id: 'playai-tts' },
    { id: 'groq/compound' },
  ];

  it('prefers a family known to honour strict output', () => {
    expect(bestReplacement(catalogue, 'llama-3.3-70b-versatile')).toBe('openai/gpt-oss-20b');
  });

  it('never picks speech, moderation or routing models', () => {
    const picked = bestReplacement([{ id: 'whisper-large-v3' }, { id: 'playai-tts' }, { id: 'llama-guard-3-8b' }], 'x');
    expect(picked).toBeNull();
  });

  it('skips the model that just failed and anything marked inactive', () => {
    expect(
      bestReplacement(
        [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b', active: false }, { id: 'qwen/qwen3-32b' }],
        'openai/gpt-oss-120b',
      ),
    ).toBe('qwen/qwen3-32b');
  });

  it('still returns an unknown new family rather than nothing', () => {
    expect(bestReplacement([{ id: 'somebrandnew/model-9' }], 'x')).toBe('somebrandnew/model-9');
  });
});

describe('withFallback', () => {
  const provider = (name: string, result: LlmResult<unknown>): LlmProvider & { calls: number } => {
    const p = {
      name,
      configured: true,
      calls: 0,
      async complete<T>() {
        p.calls += 1;
        return result as LlmResult<T>;
      },
    };
    return p;
  };
  const request = { instruction: 'i', input: 'x', schema: {} };

  it('answers from the second when the first provider has failed', async () => {
    const a = provider('groq', { ok: false, failure: 'retired', message: 'gone', provider: 'groq' });
    const b = provider('gemini', { ok: true, value: { reply: 'hi' }, provider: 'gemini' });
    const r = await withFallback(a, b).complete(request);
    expect(r.ok).toBe(true);
    expect(b.calls).toBe(1);
  });

  it('does not shop a refusal or a spent quota to another provider', async () => {
    for (const failure of ['refused', 'quota'] as const) {
      const a = provider('groq', { ok: false, failure, message: 'no', provider: 'groq' });
      const b = provider('gemini', { ok: true, value: {}, provider: 'gemini' });
      const r = await withFallback(a, b).complete(request);
      expect(r.ok).toBe(false);
      expect(b.calls).toBe(0);
    }
  });

  it('reports both reasons when both fail', async () => {
    const a = provider('groq', { ok: false, failure: 'retired', message: 'Groq said gone.', provider: 'groq' });
    const b = provider('gemini', { ok: false, failure: 'unavailable', message: 'timed out', provider: 'gemini' });
    const r = await withFallback(a, b).complete(request);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure).toBe('retired');
      expect(r.message).toContain('Groq said gone.');
      expect(r.message).toContain('timed out');
    }
  });
});

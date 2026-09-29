import { describe, it, expect } from 'vitest';
import { bestReplacement, classify, schemaUnsupported, strictSchema } from '../../supabase/functions/_shared/llm/groq';
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

describe('strictSchema', () => {
  it('closes every object, at every depth, and leaves the rest alone', () => {
    const out = strictSchema({
      type: 'object',
      properties: {
        reply: { type: 'string' },
        action: { type: 'object', properties: { kind: { type: 'string' } } },
        cited: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
      },
      required: ['reply'],
    }) as { additionalProperties: boolean; required: string[]; properties: Record<string, Record<string, unknown> & { items?: Record<string, unknown> }> };
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.action.additionalProperties).toBe(false);
    expect(out.properties.cited.items?.additionalProperties).toBe(false);
    expect(out.properties.reply).toEqual({ type: 'string' });
    expect(out.required).toEqual(['reply']);
  });

  it('keeps an explicit additionalProperties as written', () => {
    const out = strictSchema({ type: 'object', additionalProperties: true, properties: {} }) as Record<string, unknown>;
    expect(out.additionalProperties).toBe(true);
  });
});

describe('Groq schema complaints fall back to JSON mode', () => {
  it('recognises the strict-mode rule that broke the chatbot', () => {
    expect(
      schemaUnsupported(
        400,
        err("invalid JSON schema for response_format: 'reply': /properties/action: `additionalProperties:false` must be set on every object"),
      ),
    ).toBe(true);
  });
});

describe('what Abood may remember', () => {
  it('keeps short, new facts and refuses the rest', async () => {
    const { validateFacts } = await import('../../supabase/functions/_shared/abood');
    const out = validateFacts(
      {
        facts: [
          '- Works at the library on Saturday mornings',
          'Works at the library on Saturday mornings.',
          'short',
          'Commutes by metro.',
          42,
          'Prefers breaking big assignments into small steps.',
          'Plays five-a-side on Tuesdays.',
        ],
      },
      ['commutes by metro.'],
    );
    expect(out).toEqual([
      'Works at the library on Saturday mornings.',
      'Prefers breaking big assignments into small steps.',
      'Plays five-a-side on Tuesdays.',
    ]);
  });

  it('treats a reply that is not the shape as nothing learned', async () => {
    const { validateFacts } = await import('../../supabase/functions/_shared/abood');
    expect(validateFacts('nope', [])).toEqual([]);
    expect(validateFacts({ facts: 'one' }, [])).toEqual([]);
  });
});

describe('Groq rate-limit waits', () => {
  it('reads the wait from the header or from the message', async () => {
    const { retryAfter } = await import('../../supabase/functions/_shared/llm/groq');
    expect(retryAfter('3', '')).toBe(3000);
    expect(retryAfter(null, err('Rate limit reached ... Please try again in 2.7225s. Need more tokens?'))).toBeCloseTo(2722.5);
    expect(retryAfter(null, err('Please try again in 1m30s.'))).toBe(90_000);
    expect(retryAfter(null, err('Please try again in 450ms.'))).toBe(450);
    expect(retryAfter(null, err('Rate limit reached for requests per day'))).toBeNull();
  });
});

describe('sending Abood only what a message needs', () => {
  it('routes planner questions to their sections and conversation to a snapshot', async () => {
    const { scopesFor } = await import('../../supabase/functions/_shared/abood');
    const s = (m: string, prev?: string) => [...scopesFor(m, prev)].sort();
    expect(s('What is due this week?')).toEqual(['work']);
    expect(s('how much protein have i had today')).toEqual(['food', 'work']);
    expect(s('did i take my adderall')).toEqual(['checklist']);
    expect(s('When is my COEN 212 lab?')).toEqual(['work']);
    expect(s('hey whats up')).toEqual([]);
    expect(s('my friend is being weird with me, what do i do')).toEqual([]);
  });

  it('lets a short follow-up inherit what the last question needed', async () => {
    const { scopesFor } = await import('../../supabase/functions/_shared/abood');
    expect([...scopesFor('and the one after?', 'What is due this week?')]).toEqual(['work']);
    // A long new message stands on its own.
    expect([
      ...scopesFor(
        'honestly I have been thinking a lot about whether I even like engineering as a career path',
        'what is due this week',
      ),
    ]).toEqual([]);
  });

  it('keeps the planner out of a confidence unless they ask for it', async () => {
    const { modeFor } = await import('../../supabase/functions/_shared/abood');
    // These all matched WORK before, and arrived with everything due attached.
    expect(modeFor('honestly this week has been rough and i feel kind of lost')).toBe('confide');
    expect(modeFor('i keep thinking about my family and whether im doing enough with my life')).toBe('confide');
    expect(modeFor('i have no motivation for school lately')).toBe('confide');
    // A reply inside the confidence stays in it.
    expect(modeFor('yeah', 'i feel like nobody gets me')).toBe('confide');
    expect(modeFor('it just builds up at night', 'i feel like nobody gets me')).toBe('confide');
    // Asking outright is asking, whatever came before.
    expect(modeFor('ok when is my midterm', 'i feel anxious about math')).toBe('planner');
    expect(modeFor('what is due this week?')).toBe('planner');
    expect(modeFor('did i take my adderall')).toBe('planner');
    expect(modeFor('hey whats up')).toBe('chat');
  });

  it('shows no planner at all in a bare context', async () => {
    const { buildContext } = await import('../../supabase/functions/_shared/context');
    const built = buildContext(
      {
        today: '2026-09-28',
        now: '21:00',
        timezone: 'America/Toronto',
        assignments: [{ id: 'a1', title: 'WeBWorK 3', due_at: '2026-10-10T03:59:00Z', due_has_time: true, status: 'todo', effort_minutes: null }],
        events: [],
        checklist: [],
        food: { totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, targets: null, items: [] },
        savedMeals: [],
        weights: [],
      },
      { bare: true, shortIds: true },
    );
    expect(built.text).not.toContain('WeBWorK');
    expect(built.knownIds.size).toBe(0);
  });

  it('looks a month ahead only when the question reaches that far', async () => {
    const { eventDaysFor } = await import('../../supabase/functions/_shared/abood');
    expect(eventDaysFor('what do I have tomorrow')).toBe(14);
    expect(eventDaysFor('when is my midterm')).toBe(31);
  });
});

describe('withFallback and a per-minute throttle', () => {
  it('answers from the second provider when the first is only throttled for the minute', async () => {
    const mk = (r: LlmResult<unknown>) => ({ name: 'p', configured: true, async complete<T>() { return r as LlmResult<T>; } });
    const throttled = mk({ ok: false, failure: 'quota', message: 'Groq (x): Rate limit reached on tokens per minute (TPM): Limit 8000', provider: 'groq' });
    const daily = mk({ ok: false, failure: 'quota', message: 'Rate limit reached on tokens per day (TPD)', provider: 'groq' });
    const good = mk({ ok: true, value: { reply: 'hi' }, provider: 'gemini' });
    expect((await withFallback(throttled, good).complete({ instruction: '', input: '', schema: {} })).ok).toBe(true);
    expect((await withFallback(daily, good).complete({ instruction: '', input: '', schema: {} })).ok).toBe(false);
  });
});

describe('spentQuestions', () => {
  it('lists the questions Abood already asked, newest last, and ignores the user and statements', async () => {
    const { spentQuestions } = await import('../../supabase/functions/_shared/abood');
    const turns = [
      { role: 'user', content: 'did you ever ask why?' },
      { role: 'assistant', content: 'that sounds heavy.\n\nwhat hits the hardest?' },
      { role: 'user', content: 'the loneliness' },
      { role: 'assistant', content: 'okay. what part gets to you most? and when did it start?' },
    ];
    expect(spentQuestions(turns)).toEqual([
      'what hits the hardest?',
      'what part gets to you most?',
      'and when did it start?',
    ]);
    expect(spentQuestions([])).toEqual([]);
  });
});

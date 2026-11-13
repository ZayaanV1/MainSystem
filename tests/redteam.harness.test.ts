/**
 * Red-team harness for Abood. Runs only with REDTEAM=1:
 *   REDTEAM=1 npx vitest run tests/redteam.harness.test.ts
 * Claude through the Mac's Claude Code by default, as the bridge runs it.
 * REDTEAM_PROVIDER=groq or gemini tests the free fallback models instead,
 * with GROQ_API_KEY or GEMINI_API_KEY set in the shell, as askAbood calls them.
 */
import { it } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { CHAT_SCHEMA } from '../supabase/functions/_shared/chat';
import { CASES, CHAT_INSTRUCTION, runCase, type Ask } from './redteam.cases';

const OUT = process.env.REDTEAM_OUT ?? '/tmp/redteam.json';
const BIN = `${process.env.HOME}/.local/bin/claude`;

function claude(instruction: string, input: string, effort: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, [
      '-p', '--model', 'claude-sonnet-5-5', '--effort', effort,
      '--system-prompt', instruction, '--json-schema', JSON.stringify(CHAT_SCHEMA),
      '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.on('close', () => {
      try {
        const o = JSON.parse(out);
        if (o.is_error) return reject(new Error(String(o.result)));
        resolve(o.structured_output ?? JSON.parse(String(o.result).replace(/^```(?:json)?\s*|\s*```$/g, '')));
      } catch { reject(new Error((out || err).slice(0, 300))); }
    });
    child.stdin.end(input);
  });
}

/** The model call for one provider, with askAbood's own settings per mode. */
async function asker(provider: string): Promise<Ask> {
  if (provider === 'claude') return (mode, input) => claude(CHAT_INSTRUCTION, input, mode === 'chat' ? 'low' : 'medium');
  // The providers are Deno modules; this is the one thing they read from Deno.
  (globalThis as { Deno?: unknown }).Deno ??= { env: { get: (k: string) => process.env[k] } };
  const p = provider === 'groq'
    ? (await import('../supabase/functions/_shared/llm/groq')).groqProvider(process.env.GROQ_API_KEY ?? '', process.env.GROQ_MODEL || undefined)
    : (await import('../supabase/functions/_shared/llm/gemini')).geminiProvider(process.env.GEMINI_API_KEY ?? '');
  return async (mode, input) => {
    const planner = mode === 'planner';
    const r = await p.complete<unknown>({
      instruction: CHAT_INSTRUCTION, input, schema: CHAT_SCHEMA as unknown as Record<string, unknown>,
      temperature: planner ? 0.3 : mode === 'confide' ? 0.85 : 0.8,
      reasoning: planner || mode === 'confide' ? 'medium' : 'low', maxOutputTokens: 2_000, timeoutMs: 45_000,
    });
    if (!r.ok) throw new Error(`${r.failure}: ${r.message}`);
    return r.value;
  };
}

it.runIf(process.env.REDTEAM === '1')('red team', async () => {
  const ask = await asker(process.env.REDTEAM_PROVIDER ?? 'claude');
  const results: unknown[] = [];
  const queue = [...CASES];
  await Promise.all(Array.from({ length: process.env.REDTEAM_PROVIDER && process.env.REDTEAM_PROVIDER !== 'claude' ? 2 : 6 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      results.push(await runCase(c, ask));
      console.log('done', c.id);
    }
  }));
  writeFileSync(OUT, JSON.stringify({ instructionChars: CHAT_INSTRUCTION.length, results }, null, 2));
}, 1_800_000);

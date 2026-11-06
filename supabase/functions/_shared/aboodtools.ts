import { ToolError } from './mcp.ts';
import { ALL_TOOLS } from './tools.ts';
import type { ToolCall } from './chat.ts';
import type { ConnectorCtx } from './connector.ts';

/**
 * Abood's hands: running the changes he asked for through the shared tools.
 *
 * Saved at once and recorded with Undo, like the connector. Two cases wait
 * for a yes instead, because they are where a misread costs the most: any
 * delete, and more than MAX_UNASKED changes in one reply.
 */

export const MAX_UNASKED = 5;

// deno-lint-ignore no-explicit-any
type Db = any;

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

/** Every tool name Abood may use. */
export const TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));

/**
 * The menu in the prompt: name, arguments, and the first sentence of what it
 * does. Generated from the tools themselves, so it cannot drift from them.
 * Roughly 900 tokens, so it is only sent when the planner is in play.
 */
export function toolMenu(): string {
  const lines = ALL_TOOLS.map((t) => {
    const props = (t.inputSchema.properties ?? {}) as Record<string, unknown>;
    const required = new Set((t.inputSchema.required as string[] | undefined) ?? []);
    const args = Object.keys(props).map((k) => (required.has(k) ? k : `${k}?`)).join(', ');
    const what = t.description.split(/(?<=\.)\s/)[0];
    return `  ${t.name}(${args})${t.readOnly ? ' [read]' : ''} — ${what}`;
  });
  return `TOOLS\n${lines.join('\n')}`;
}

export const isRead = (call: ToolCall) => byName.get(call.tool)?.readOnly === true;

/** Whether these changes wait for a yes. */
export function needsYes(calls: ToolCall[]): boolean {
  return calls.length > MAX_UNASKED || calls.some((c) => byName.get(c.tool)?.destructive);
}

/** A change in words, for the yes question: the tool, and the names of what it touches. */
export function describeCall(call: ToolCall, names: Map<string, string>): string {
  const what = call.tool.replace(/_/g, ' ');
  const about = Object.values(call.args)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => names.get(v))
    .filter(Boolean);
  return about.length ? `${what}: ${about.join(', ')}` : what;
}

export interface RunResult {
  /** What changed, as recorded in the undo log. */
  done: string[];
  /** What could not be done, and why. */
  failed: string[];
  /** Results of read tools, as the model will read them. */
  read: string[];
}

/** Run calls one after another; one failing does not stop the rest, and says why. */
export async function runCalls(db: Db, userId: string, tz: string, calls: ToolCall[], now = new Date()): Promise<RunResult> {
  const ctx: ConnectorCtx = { db, userId, clientId: 'abood', tz, now };
  const started = new Date(now.getTime() - 1000).toISOString();
  const failed: string[] = [];
  const read: string[] = [];
  for (const call of calls) {
    const t = byName.get(call.tool);
    if (!t) continue;
    try {
      const out = await t.run(call.args, ctx);
      if (t.readOnly) read.push(`${call.tool}: ${out.slice(0, 6000)}`);
    } catch (e) {
      failed.push(e instanceof ToolError ? e.message : `${call.tool.replace(/_/g, ' ')} did not work on the planner side`);
      if (!(e instanceof ToolError)) console.error('abood tool failed', call.tool, e);
    }
  }
  const { data } = await db
    .from('connector_changes')
    .select('summary')
    .eq('user_id', userId)
    .eq('client_id', 'abood')
    .gte('created_at', started)
    .order('created_at');
  return { done: ((data ?? []) as { summary: string }[]).map((r) => r.summary), failed, read };
}

/** What follows Abood's reply: what actually changed, and what did not. */
export function outcomeText(r: Pick<RunResult, 'done' | 'failed'>): string {
  const parts: string[] = [];
  if (r.done.length) parts.push(`Changed: ${r.done.join('; ')}. Say "undo" to take it back, or use Settings, Connected apps.`);
  if (r.failed.length) parts.push(`Not changed: ${r.failed.join(' ')}`);
  return parts.join('\n\n');
}

/** "yes", "do it", "go ahead": an answer to a waiting change, not a new question. */
export function isYes(message: string): boolean {
  return /^(y|ya|yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|confirm|go for it|please do|yes please)[\s.!]*$/i.test(message.trim());
}

export function isNo(message: string): boolean {
  return /^(n|no|nope|nah|cancel|don'?t|stop|leave it)[\s.!]*$/i.test(message.trim());
}

export function isUndo(message: string): boolean {
  return /^(undo|undo (that|it|this)|take (that|it) back|revert( that| it)?)[\s.!]*$/i.test(message.trim());
}

/** The proposal stored on a chat message while it waits for a yes. */
export interface PendingChange {
  kind: 'tools';
  calls: ToolCall[];
  summary: string[];
}

export function asPending(v: unknown): PendingChange | null {
  const p = v as PendingChange | null;
  return p && p.kind === 'tools' && Array.isArray(p.calls) ? p : null;
}

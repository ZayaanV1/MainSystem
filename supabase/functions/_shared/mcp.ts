/**
 * The Model Context Protocol, the small part of it a connector needs
 * (functions/mcp, Nov 2026).
 *
 * Hand-written rather than the SDK: a stateless server that answers one
 * JSON-RPC message per POST with JSON needs initialize, tools/list,
 * tools/call and ping, which is this file. Every dependency is a thing that
 * can break at 2am, and this one would have pulled a session layer, SSE and
 * a schema library into a function that uses none of them.
 *
 * Tool failures are results with isError, not protocol errors: the model
 * reads the sentence and can correct itself ("No course called PHYS 999 —
 * these exist: ..."), which a JSON-RPC error code would hide from it.
 */

export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

export interface ToolDef<C> {
  name: string;
  /** Shown to the model, and in some apps to the person approving the call. */
  description: string;
  inputSchema: Record<string, unknown>;
  /** Changes nothing: lets apps skip their allow prompt for it. */
  readOnly: boolean;
  /** Removes something: apps ask before it, and Abood confirms first. */
  destructive?: boolean;
  run: (args: Record<string, unknown>, ctx: C) => Promise<string>;
}

/** A failure the model should read and act on. */
export class ToolError extends Error {}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type RpcResponse = Record<string, unknown> | null;

const reply = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/**
 * One message in, one response out; null for a notification, which gets 202
 * and no body. A batch (an array) is refused: the 2025-06-18 revision removed
 * them, and nothing here needs one.
 */
export async function handleRpc<C>(
  message: unknown,
  tools: ToolDef<C>[],
  ctx: C,
  server: { name: string; version: string; instructions?: string },
): Promise<RpcResponse> {
  if (Array.isArray(message) || !message || typeof message !== 'object') {
    return fail(null, -32600, 'Expected a single JSON-RPC request object.');
  }
  const req = message as RpcRequest;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') return fail(req.id, -32600, 'Not a JSON-RPC 2.0 request.');
  const isNotification = req.id === undefined;

  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '');
      const version = (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : SUPPORTED_VERSIONS[0];
      return reply(req.id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
        ...(server.instructions ? { instructions: server.instructions } : {}),
      });
    }
    case 'ping':
      return reply(req.id, {});
    case 'tools/list':
      return reply(req.id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly, destructiveHint: Boolean(t.destructive) },
        })),
      });
    case 'tools/call': {
      const name = req.params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return fail(req.id, -32602, `Unknown tool: ${String(name)}`);
      const args = req.params?.arguments;
      if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
        return fail(req.id, -32602, 'Tool arguments must be an object.');
      }
      try {
        const text = await tool.run((args ?? {}) as Record<string, unknown>, ctx);
        return reply(req.id, { content: [{ type: 'text', text }], isError: false });
      } catch (e) {
        if (e instanceof ToolError) return reply(req.id, { content: [{ type: 'text', text: e.message }], isError: true });
        console.error('tool failed', tool.name, e);
        return reply(req.id, { content: [{ type: 'text', text: 'That did not work on the planner side. Nothing was changed by the failed step; try again.' }], isError: true });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized and friends
      return fail(req.id, -32601, `Method not found: ${req.method}`);
  }
}

/* ---- argument readers: the model writes these, so each is checked ---- */

export function str(args: Record<string, unknown>, key: string, opts: { max: number; required?: boolean }): string | null {
  const v = args[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new ToolError(`"${key}" is required.`);
    return null;
  }
  if (typeof v !== 'string') throw new ToolError(`"${key}" must be text.`);
  const t = v.trim();
  if (opts.required && !t) throw new ToolError(`"${key}" cannot be blank.`);
  if (t.length > opts.max) throw new ToolError(`"${key}" is longer than ${opts.max} characters.`);
  return t || null;
}

export function day(args: Record<string, unknown>, key: string, required = false): string | null {
  const v = str(args, key, { max: 10, required });
  if (v === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new ToolError(`"${key}" must be a date as YYYY-MM-DD.`);
  }
  return v;
}

export function time(args: Record<string, unknown>, key: string): string | null {
  const v = str(args, key, { max: 5 });
  if (v === null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new ToolError(`"${key}" must be a 24-hour time as HH:MM.`);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function int(args: Record<string, unknown>, key: string, min: number, max: number): number | null {
  const v = args[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ToolError(`"${key}" must be a whole number from ${min} to ${max}.`);
  }
  return v;
}

export function bool(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') throw new ToolError(`"${key}" must be true or false.`);
  return v;
}

export function uuid(args: Record<string, unknown>, key: string): string {
  const v = str(args, key, { max: 36, required: true }) as string;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new ToolError(`"${key}" must be an id from an earlier result.`);
  }
  return v.toLowerCase();
}

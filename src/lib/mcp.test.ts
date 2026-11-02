import { describe, expect, it } from 'vitest';
import { day, handleRpc, int, time, ToolError, type ToolDef } from '../../supabase/functions/_shared/mcp';

const tools: ToolDef<{ who: string }>[] = [
  { name: 'hello', description: 'd', inputSchema: { type: 'object' }, readOnly: true, run: async (_a, ctx) => `hi ${ctx.who}` },
  {
    name: 'picky',
    description: 'd',
    inputSchema: { type: 'object' },
    readOnly: false,
    run: async () => {
      throw new ToolError('No course called PHYS 999.');
    },
  },
  {
    name: 'broken',
    description: 'd',
    inputSchema: { type: 'object' },
    readOnly: false,
    run: async () => {
      throw new Error('db exploded with secret detail');
    },
  },
];
const server = { name: 'planner', version: '1' };
const call = (m: unknown) => handleRpc(m, tools, { who: 'zed' }, server);

describe('handleRpc', () => {
  it('agrees a protocol version, falling back to the newest it knows', async () => {
    const known = (await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })) as any;
    expect(known.result.protocolVersion).toBe('2025-06-18');
    const unknown = (await call({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })) as any;
    expect(unknown.result.protocolVersion).toBe('2025-11-25');
    expect(unknown.result.capabilities.tools).toBeDefined();
  });

  it('lists tools with read-only hints', async () => {
    const r = (await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as any;
    expect(r.result.tools.map((t: any) => [t.name, t.annotations.readOnlyHint])).toEqual([
      ['hello', true],
      ['picky', false],
      ['broken', false],
    ]);
  });

  it('runs a tool with the request context', async () => {
    const r = (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hello', arguments: {} } })) as any;
    expect(r.result).toEqual({ content: [{ type: 'text', text: 'hi zed' }], isError: false });
  });

  it('hands a tool error to the model as text it can act on', async () => {
    const r = (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'picky' } })) as any;
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toBe('No course called PHYS 999.');
  });

  it('never leaks an internal error', async () => {
    const r = (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'broken' } })) as any;
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).not.toContain('secret');
  });

  it('answers notifications with nothing, and unknown methods with an error', async () => {
    expect(await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const r = (await call({ jsonrpc: '2.0', id: 9, method: 'resources/list' })) as any;
    expect(r.error.code).toBe(-32601);
  });

  it('refuses batches and malformed requests', async () => {
    expect(((await call([])) as any).error.code).toBe(-32600);
    expect(((await call({ id: 1, method: 'ping' })) as any).error.code).toBe(-32600);
    expect(((await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } })) as any).error.code).toBe(-32602);
  });
});

describe('argument readers', () => {
  it('reads dates and times strictly', () => {
    expect(day({ d: '2026-11-05' }, 'd')).toBe('2026-11-05');
    expect(() => day({ d: 'Friday' }, 'd')).toThrow(ToolError);
    expect(time({ t: '9:05' }, 't')).toBe('09:05');
    expect(() => time({ t: '25:00' }, 't')).toThrow(ToolError);
  });

  it('bounds numbers', () => {
    expect(int({ n: 30 }, 'n', 1, 600)).toBe(30);
    expect(() => int({ n: 2.5 }, 'n', 1, 600)).toThrow(ToolError);
    expect(int({}, 'n', 1, 600)).toBeNull();
  });
});

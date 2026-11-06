import { describe, it, expect } from 'vitest';
import { validateCalls } from '../../supabase/functions/_shared/chat';
import { describeCall, isNo, isUndo, isYes, needsYes, toolMenu, TOOL_NAMES } from '../../supabase/functions/_shared/aboodtools';
import { ALL_TOOLS } from '../../supabase/functions/_shared/tools';
import { undoSteps } from '../../supabase/functions/_shared/undo';

const REAL = '11111111-2222-3333-4444-555555555555';

describe('validateCalls', () => {
  const known = new Set(['w1', 'b2']);
  const aliases = new Map([['w1', REAL], ['b2', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']]);

  it('turns labels into real ids after checking them', () => {
    const warnings: string[] = [];
    const calls = validateCalls([{ tool: 'update_work', args: '{"id":"w1","due_date":"2026-11-12"}' }], known, aliases, TOOL_NAMES, warnings);
    expect(calls).toEqual([{ tool: 'update_work', args: { id: REAL, due_date: '2026-11-12' } }]);
    expect(warnings).toEqual([]);
  });

  it('drops a change naming something it was never shown', () => {
    const warnings: string[] = [];
    expect(validateCalls([{ tool: 'delete_work', args: '{"id":"w9"}' }], known, aliases, TOOL_NAMES, warnings)).toEqual([]);
    expect(validateCalls([{ tool: 'delete_work', args: `{"id":"${'9'.repeat(8)}-2222-3333-4444-555555555555"}` }], known, aliases, TOOL_NAMES, warnings)).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it('drops unknown tools and unreadable arguments', () => {
    const warnings: string[] = [];
    expect(validateCalls([{ tool: 'delete_account', args: '{}' }, { tool: 'update_work', args: '{not json' }], known, aliases, TOOL_NAMES, warnings)).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it('keeps course codes and other text as they are', () => {
    const calls = validateCalls([{ tool: 'add_work', args: '{"title":"Lab 4","course":"COEN 231"}' }], known, aliases, TOOL_NAMES, []);
    expect(calls[0].args).toEqual({ title: 'Lab 4', course: 'COEN 231' });
  });
});

describe('when Abood asks first', () => {
  it('asks before any delete and before more than five changes', () => {
    expect(needsYes([{ tool: 'delete_work', args: {} }])).toBe(true);
    expect(needsYes(Array.from({ length: 5 }, () => ({ tool: 'update_work', args: {} })))).toBe(false);
    expect(needsYes(Array.from({ length: 6 }, () => ({ tool: 'update_work', args: {} })))).toBe(true);
  });

  it('reads yes, no and undo, and nothing longer as one', () => {
    for (const y of ['yes', 'Yeah', 'do it', 'go ahead.', 'ok']) expect(isYes(y)).toBe(true);
    for (const n of ['no', 'Nope', 'cancel']) expect(isNo(n)).toBe(true);
    expect(isYes('yes but move it to friday instead')).toBe(false);
    expect(isUndo('undo that')).toBe(true);
    expect(isUndo('how do I undo a git commit')).toBe(false);
  });

  it('describes a waiting change by name, not id', () => {
    expect(describeCall({ tool: 'delete_work', args: { id: REAL } }, new Map([[REAL, 'Lab 3']]))).toBe('delete work: Lab 3');
  });
});

describe('the tool layer', () => {
  it('marks every delete as destructive, and nothing else', () => {
    for (const t of ALL_TOOLS) expect(Boolean(t.destructive)).toBe(t.name.startsWith('delete_'));
  });

  it('has unique names and a menu line for each', () => {
    expect(new Set(ALL_TOOLS.map((t) => t.name)).size).toBe(ALL_TOOLS.length);
    const menu = toolMenu();
    for (const t of ALL_TOOLS) expect(menu).toContain(`  ${t.name}(`);
  });

  it('cannot reach the account, keys, channels or linked chats', () => {
    expect([...TOOL_NAMES].some((n) => /account|key|channel|telegram|imessage|password/.test(n))).toBe(false);
  });
});

describe('undo of a delete', () => {
  it('puts the row back, then what it took with it', () => {
    const steps = undoSteps({
      id: 'c1',
      client_id: 'abood',
      tool: 'delete_work',
      target_table: 'assignments',
      target_id: 'a1',
      before: {
        __deleted: { id: 'a1', title: 'Lab' },
        __restore: [{ table: 'subtasks', op: 'upsert', payload: { id: 's1' }, match: {} }],
      },
      summary: 'Deleted “Lab”',
      created_at: '2026-11-06T00:00:00Z',
      undone_at: null,
    });
    expect(steps.map((s) => `${s.table}:${s.op}`)).toEqual(['assignments:upsert', 'subtasks:upsert', 'connector_changes:update']);
  });

  it('matches course pages and settings by their owner', () => {
    const [first] = undoSteps({
      id: 'c2', client_id: 'abood', tool: 'update_plan_settings', target_table: 'app_settings', target_id: 'u1',
      before: { plan_day_cap: 240 }, summary: 'x', created_at: '', undone_at: null,
    });
    expect(first.match).toEqual({ user_id: 'u1' });
  });
});

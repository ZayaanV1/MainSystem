import { describe, expect, it } from 'vitest';
import { undoSteps, type ConnectorChange } from './connections';

const NOW = new Date('2026-11-02T12:00:00Z');
function change(over: Partial<ConnectorChange>): ConnectorChange {
  return {
    id: 'c1', client_id: 'claude', tool: 'add_work', target_table: 'assignments', target_id: 'a1',
    before: null, summary: 'x', created_at: NOW.toISOString(), undone_at: null, ...over,
  };
}

describe('undoSteps', () => {
  it('removes work the app added, and stamps the change undone', () => {
    expect(undoSteps(change({}), NOW)).toEqual([
      { table: 'assignments', op: 'delete', payload: {}, match: { id: 'a1' } },
      { table: 'connector_changes', op: 'update', payload: { undone_at: NOW.toISOString() }, match: { id: 'c1' } },
    ]);
  });

  it('dismisses an inbox thought rather than deleting it', () => {
    const [first] = undoSteps(change({ tool: 'add_to_inbox', target_table: 'inbox_items', target_id: 'i1' }), NOW);
    expect(first).toEqual({ table: 'inbox_items', op: 'update', payload: { dismissed_at: NOW.toISOString() }, match: { id: 'i1' } });
  });

  it('puts a moved due date back and removes the deferral the move wrote', () => {
    const steps = undoSteps(
      change({ tool: 'move_work', before: { due_at: '2026-11-03T04:59:00Z', due_has_time: false, deferral_id: 'd1' } }),
      NOW,
    );
    expect(steps.slice(0, 2)).toEqual([
      { table: 'assignments', op: 'update', payload: { due_at: '2026-11-03T04:59:00Z', due_has_time: false }, match: { id: 'a1' } },
      { table: 'deferrals', op: 'delete', payload: {}, match: { id: 'd1' } },
    ]);
  });

  it('reopens work it marked done, with no deferral step', () => {
    const steps = undoSteps(change({ tool: 'set_work_done', before: { status: 'todo', completed_at: null } }), NOW);
    expect(steps).toHaveLength(2);
    expect(steps[0].payload).toEqual({ status: 'todo', completed_at: null });
  });
});

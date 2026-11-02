import { supabase } from './supabase';
import { enqueue, type OutboxOp } from './outbox';

/**
 * Apps connected to the planner, and what they changed (Nov 2026;
 * functions/mcp, migration 0050).
 *
 * An AI app's changes save at once; this is the other half of that bargain.
 * Every change is listed with Undo, and the app can be disconnected, which
 * Supabase Auth carries out by revoking its grant and every token it holds.
 */

export interface ConnectedApp {
  clientId: string;
  name: string;
  grantedAt: string;
}

export interface ConnectorChange {
  id: string;
  client_id: string | null;
  tool: string;
  target_table: 'assignments' | 'events' | 'inbox_items';
  target_id: string;
  before: Record<string, unknown> | null;
  summary: string;
  created_at: string;
  undone_at: string | null;
}

export async function loadConnectedApps(): Promise<{ apps: ConnectedApp[]; error: string | null }> {
  const { data, error } = await supabase.auth.oauth.listGrants();
  if (error) return { apps: [], error: error.message };
  return {
    apps: (data ?? []).map((g) => ({ clientId: g.client.id, name: g.client.name || 'An app', grantedAt: g.granted_at })),
    error: null,
  };
}

export async function disconnectApp(clientId: string): Promise<string | null> {
  const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
  return error?.message ?? null;
}

export async function loadConnectorChanges(limit = 30): Promise<{ changes: ConnectorChange[]; error: string | null }> {
  const { data, error } = await supabase
    .from('connector_changes')
    .select('id, client_id, tool, target_table, target_id, before, summary, created_at, undone_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { changes: (data ?? []) as ConnectorChange[], error: error?.message ?? null };
}

export interface UndoStep {
  table: string;
  op: OutboxOp;
  payload: Record<string, unknown>;
  match: Record<string, unknown>;
}

/**
 * What taking a change back writes. A row the app created is removed, except
 * an inbox thought, which is dismissed as the inbox's own Dismiss does; a
 * changed row gets its earlier values back, and a deferral the move wrote is
 * removed with it, so an undone move leaves no trace in the stuck-work count.
 */
export function undoSteps(change: ConnectorChange, now: Date = new Date()): UndoStep[] {
  const steps: UndoStep[] = [];
  const target = { id: change.target_id };
  if (change.before === null) {
    steps.push(
      change.target_table === 'inbox_items'
        ? { table: 'inbox_items', op: 'update', payload: { dismissed_at: now.toISOString() }, match: target }
        : { table: change.target_table, op: 'delete', payload: {}, match: target },
    );
  } else {
    const { deferral_id, ...fields } = change.before;
    steps.push({ table: change.target_table, op: 'update', payload: fields, match: target });
    if (typeof deferral_id === 'string') steps.push({ table: 'deferrals', op: 'delete', payload: {}, match: { id: deferral_id } });
  }
  steps.push({ table: 'connector_changes', op: 'update', payload: { undone_at: now.toISOString() }, match: { id: change.id } });
  return steps;
}

/** Through the outbox, like every other write: undo works offline and shows at once. */
export async function undoChange(change: ConnectorChange): Promise<void> {
  for (const s of undoSteps(change)) await enqueue(s.table, s.op, s.payload, s.match);
}

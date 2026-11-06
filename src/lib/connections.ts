import { supabase } from './supabase';
import { enqueue } from './outbox';
import { undoSteps, type ChangeRow } from '../../supabase/functions/_shared/undo';

export { undoSteps };

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

/** A change an AI made: the app's name for the shared row. */
export type ConnectorChange = ChangeRow;

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

/** Through the outbox, like every other write: undo works offline and shows at once. */
export async function undoChange(change: ConnectorChange): Promise<void> {
  for (const s of undoSteps(change)) await enqueue(s.table, s.op, s.payload, s.match);
}

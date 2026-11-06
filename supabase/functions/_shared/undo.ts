/**
 * Taking back a change an AI made (connector_changes, migrations 0050, 0052).
 *
 * Shared by the app (Settings > Connected apps, through the outbox) and the
 * server (Abood's "undo that"), so both take a change back the same way.
 *
 * `before` says what to restore:
 *   - null: the row was created; undo removes it (an inbox thought is
 *     dismissed instead, as the inbox's own Dismiss does);
 *   - { __deleted: row, __restore?: steps }: the row was deleted; undo puts it
 *     back, then runs the steps the delete recorded (subtasks it took with it,
 *     work that lost its course);
 *   - any other object: the fields the change overwrote, written back. A
 *     `deferral_id` among them is the deferral a move wrote, removed with it.
 */

export type UndoOp = 'insert' | 'update' | 'upsert' | 'delete';

export interface UndoStep {
  table: string;
  op: UndoOp;
  payload: Record<string, unknown>;
  match: Record<string, unknown>;
}

export interface ChangeRow {
  id: string;
  client_id: string | null;
  tool: string;
  target_table: string;
  target_id: string;
  before: Record<string, unknown> | null;
  summary: string;
  created_at: string;
  undone_at: string | null;
}

/** The key a table is matched on: most by id, two by their owner. */
export function keyOf(table: string, id: string): Record<string, unknown> {
  if (table === 'course_pages') return { course_id: id };
  if (table === 'app_settings') return { user_id: id };
  return { id };
}

export function undoSteps(change: ChangeRow, now: Date = new Date()): UndoStep[] {
  const steps: UndoStep[] = [];
  const target = keyOf(change.target_table, change.target_id);
  const before = change.before;
  if (before === null) {
    steps.push(
      change.target_table === 'inbox_items'
        ? { table: 'inbox_items', op: 'update', payload: { dismissed_at: now.toISOString() }, match: target }
        : { table: change.target_table, op: 'delete', payload: {}, match: target },
    );
  } else if (before.__deleted && typeof before.__deleted === 'object') {
    steps.push({ table: change.target_table, op: 'upsert', payload: before.__deleted as Record<string, unknown>, match: {} });
    if (Array.isArray(before.__restore)) steps.push(...(before.__restore as UndoStep[]));
  } else {
    const { deferral_id, ...fields } = before;
    steps.push({ table: change.target_table, op: 'update', payload: fields, match: target });
    if (typeof deferral_id === 'string') steps.push({ table: 'deferrals', op: 'delete', payload: {}, match: { id: deferral_id } });
  }
  steps.push({ table: 'connector_changes', op: 'update', payload: { undone_at: now.toISOString() }, match: { id: change.id } });
  return steps;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Run undo steps directly, scoped to the account (the server's service client bypasses RLS). */
export async function applyUndo(db: Db, userId: string, change: ChangeRow, now: Date = new Date()): Promise<void> {
  for (const s of undoSteps(change, now)) {
    let q;
    if (s.op === 'insert' || s.op === 'upsert') {
      const row = { ...s.payload, user_id: userId };
      q = s.op === 'insert' ? db.from(s.table).insert(row) : db.from(s.table).upsert(row);
    } else {
      q = s.op === 'delete' ? db.from(s.table).delete() : db.from(s.table).update(s.payload);
      q = q.eq('user_id', userId);
      for (const [k, v] of Object.entries(s.match)) q = q.eq(k, v);
    }
    const { error } = await q;
    if (error) throw new Error(error.message);
  }
}

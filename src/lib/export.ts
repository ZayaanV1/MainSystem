import { supabase } from './supabase';

/**
 * Data export.
 *
 * "I want to be able to leave." A planner you cannot walk away from is a
 * planner you are trapped in, and being trapped in something is its own
 * reason to stop opening it. So this exports everything, in two formats, with
 * no server round-trip beyond the reads.
 *
 * The table list is explicit rather than discovered, so a future table has to
 * be consciously added here. An export that silently omits your coursework is
 * worse than no export.
 */

/**
 * Every table that holds something of yours, with the columns to read.
 *
 * '*' unless the table's reads are limited by column (migration 0034): a
 * select of every column there is refused outright, which used to fail the
 * whole export at its first table. Abood's facts leave out their embeddings,
 * which are 768 numbers each and mean nothing outside this database.
 *
 * Only these are left out, each for a reason (and a test fails if a new table
 * is in neither list): one-time Telegram link codes, and texts queued for the
 * iMessage bridge, which exist for seconds.
 */
export const EXPORTED: Record<string, string> = {
  app_settings: [
    'user_id', 'timezone', 'digest_hour', 'digest_minute', 'digest_enabled',
    'assignment_window_days', 'event_window_days', 'critical_days', 'urgent_days',
    'approaching_days', 'low_battery', 'created_at', 'updated_at',
    'weekly_review_enabled', 'weekly_review_weekday', 'onboarded_at', 'abood_checkins',
    'abood_checkin_every_hours', 'abood_checkin_from', 'abood_checkin_until',
    'theme', 'today_order', 'today_hidden', 'modules_off', 'board',
  ].join(','),
  courses: '*',
  course_pages: '*',
  assignments: '*',
  assignment_series: '*',
  subtasks: '*',
  deferrals: '*',
  events: '*',
  class_series: '*',
  goals: '*',
  calendar_feeds: '*',
  checklist_items: '*',
  checklist_completions: '*',
  inbox_items: '*',
  daily_summaries: '*',
  chat_messages: '*',
  memory_facts: 'id,fact,source,course_id,created_at',
  notification_channels: '*',
  push_subscriptions: '*',
  delivery_log: '*',
  imessage_links: '*',
  imessage_bridges: 'user_id,address,last_seen,created_at',
  ai_usage: '*',
};

export const NOT_EXPORTED = ['telegram_link_codes', 'imessage_outbox'] as const;

export interface ExportBundle {
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function collectExport(): Promise<ExportBundle> {
  const tables: Record<string, unknown[]> = {};

  for (const [table, columns] of Object.entries(EXPORTED)) {
    const { data, error } = await supabase.from(table).select(columns);
    if (error) throw new Error(`Couldn’t read ${table.replace(/_/g, ' ')}. ${error.message}`);
    tables[table] = data ?? [];
  }

  return { exportedAt: new Date().toISOString(), tables };
}

/** RFC 4180 quoting: double the quotes, wrap anything containing a delimiter. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return '';

  // Union of keys across all rows, so a column present on only some rows is
  // not dropped.
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r as object)))];

  return [
    columns.join(','),
    ...rows.map((row) => columns.map((c) => csvCell((row as Record<string, unknown>)[c])).join(',')),
  ].join('\n');
}

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportJson(): Promise<void> {
  const bundle = await collectExport();
  download(`life-planner-${stamp()}.json`, JSON.stringify(bundle, null, 2), 'application/json');
}

/**
 * One CSV per table, concatenated with a header line naming each. A single
 * file keeps the export to one tap; the table names make it splittable by
 * anything that reads CSV.
 */
export async function exportCsv(): Promise<void> {
  const bundle = await collectExport();

  const body = Object.entries(bundle.tables)
    .map(([table, rows]) => `# ${table}\n${toCsv(rows)}`)
    .join('\n\n');

  download(`life-planner-${stamp()}.csv`, body, 'text/csv');
}

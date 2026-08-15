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
 * be consciously added here. An export that silently omits your food log is
 * worse than no export.
 */

const EXPORTED_TABLES = [
  'app_settings',
  'notification_channels',
  'push_subscriptions',
  'delivery_log',
] as const;

export interface ExportBundle {
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function collectExport(): Promise<ExportBundle> {
  const tables: Record<string, unknown[]> = {};

  for (const table of EXPORTED_TABLES) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) throw new Error(`Couldn't read ${table}. ${error.message}`);
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

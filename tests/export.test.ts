import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({ supabase: {} }));
const { EXPORTED, NOT_EXPORTED } = await import('../src/lib/export');

const MIGRATIONS = join(process.cwd(), 'supabase/migrations');

/** Tables that exist after every migration has run: created, and not dropped since. */
function liveTables(): string[] {
  const dir = MIGRATIONS;
  const live = new Set<string>();
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)) live.add(m[1]);
    for (const m of sql.matchAll(/drop table (?:if exists )?public\.([a-z_]+)/g)) live.delete(m[1]);
  }
  return [...live].sort();
}

describe('the export', () => {
  it('covers every table, or says why not', () => {
    // An export that silently omits your coursework is worse than none. It
    // once held four tables of settings and none of the work.
    const accounted = new Set([...Object.keys(EXPORTED), ...NOT_EXPORTED]);
    expect(liveTables().filter((t) => !accounted.has(t))).toEqual([]);
  });

  it('names no table that no longer exists', () => {
    const live = new Set(liveTables());
    expect(Object.keys(EXPORTED).filter((t) => !live.has(t))).toEqual([]);
  });

  it('asks for app_settings by column, which is how it is readable', () => {
    const migrations = readdirSync(MIGRATIONS)
      .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
      .join('\n');
    const granted = new Set(
      [...migrations.matchAll(/grant select \(([^)]+)\) on public\.app_settings/g)].flatMap((m) =>
        m[1].split(',').map((c) => c.trim()),
      ),
    );
    const asked = EXPORTED.app_settings.split(',');
    expect(asked.filter((c) => !granted.has(c))).toEqual([]);
    expect(asked).not.toContain('gemini_api_key');
  });
});

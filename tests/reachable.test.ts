import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards against the failure mode this project keeps producing: a mechanism
 * that exists, works, and is never reached.
 *
 * It has now happened often enough to be a class rather than a run of bad
 * luck. The Gemini provider computed the list of models a key could call and
 * both callers substituted fixed copy over it. `weight_percent` was extracted
 * from a syllabus, validated, and then dropped. `EmptyState` grew an action
 * slot nothing passed. The forecast computed minutes per day for months with
 * nothing drawing them. The `assignment_series` table was written at creation
 * and never read back, so a pattern that made two hundred rows could not
 * afterwards be seen, ended or extended.
 *
 * Every one of these typechecks, ships, and is invisible from both ends —
 * whoever wrote the mechanism can see it working, and whoever uses the app
 * sees a feature that simply is not there. A type system cannot see it,
 * because nothing is wrong with the types. Reachability is the property, and
 * these two tests are the cheapest useful approximation of it.
 */

function sourceFiles(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, ext);
    return ext.some((e) => entry.name.endsWith(e)) ? [full] : [];
  });
}

const SOURCE = sourceFiles('src', ['.tsx', '.ts']).filter((f) => !f.endsWith('.test.ts'));
const FUNCTIONS = sourceFiles('supabase/functions', ['.ts']).filter(
  (f) => !f.endsWith('.test.ts'),
);

const CORPUS = new Map(SOURCE.map((f) => [f, readFileSync(f, 'utf8')]));

/**
 * The two entry points, which nothing imports by design.
 *
 * Listed explicitly rather than pattern-matched: an exemption that grows by
 * accident is how a guard stops guarding.
 */
const ENTRY_POINTS = ['src/main.tsx', 'src/App.tsx'];

describe('every component is reachable', () => {
  it('finds files to check at all', () => {
    // Guards the guard: a broken walk would make everything below pass.
    expect(CORPUS.size).toBeGreaterThan(40);
    expect(FUNCTIONS.length).toBeGreaterThan(10);
  });

  it('leaves no component that nothing renders', () => {
    const orphans: string[] = [];

    for (const [file, source] of CORPUS) {
      if (!file.endsWith('.tsx')) continue;
      if (ENTRY_POINTS.some((e) => file.endsWith(e))) continue;

      const exported = [...source.matchAll(/^export function ([A-Z][A-Za-z0-9]*)/gm)].map(
        (m) => m[1],
      );
      if (exported.length === 0) continue;

      const referenced = [...CORPUS].some(
        ([other, text]) =>
          other !== file && exported.some((name) => new RegExp(`\\b${name}\\b`).test(text)),
      );

      if (!referenced) orphans.push(`${file} (${exported.join(', ')})`);
    }

    expect(
      orphans,
      'These components are written but nothing renders them. Wire them up or delete them — ' +
        'a component that exists and is unreachable reads as a finished feature in every ' +
        'review of the source and is absent from the app.',
    ).toEqual([]);
  });
});

describe('every table written is also read', () => {
  /** The first thing done to a table after `.from('x')`. */
  const VERB = /\.from\(\s*'([a-z_]+)'\s*\)\s*\.?\s*\n?\s*\.?(insert|upsert|select|update|delete)/g;

  it('leaves no table the app writes and never reads back', () => {
    const written = new Set<string>();
    const read = new Set<string>();

    for (const source of CORPUS.values()) {
      for (const m of source.matchAll(VERB)) {
        (m[2] === 'insert' || m[2] === 'upsert' ? written : read).add(m[1]);
      }
      // Writes that go through the offline outbox name their table in a
      // payload rather than a query, and count exactly the same.
      for (const m of source.matchAll(/table:\s*'([a-z_]+)'/g)) written.add(m[1]);
    }

    // A table the client writes and only the server reads is fine — the digest
    // and the calendar feed are both exactly that.
    for (const file of FUNCTIONS) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)[\s\S]{0,40}?\.(select)/g)) {
        read.add(m[1]);
      }
    }

    const writeOnly = [...written].filter((t) => !read.has(t)).sort();

    expect(
      writeOnly,
      'These tables are written and never read back. That is how a feature ends up ' +
        'half-built without anything failing: the rows are there, the schema describes ' +
        'behaviour the app cannot perform, and the user has no way to see or undo what ' +
        'was written.',
    ).toEqual([]);
  });
});

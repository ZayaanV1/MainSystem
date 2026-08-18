import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural guards on the markup itself.
 *
 * These exist because the same bug arrived twice in one evening from two
 * different components, and neither time was it visible: a button inside a
 * form with no `type` defaults to submit, so "Delete" saved, "Remove from
 * list" saved, and tapping a date shortcut submitted the form. Every one of
 * them did the opposite of its label, silently and without an error anywhere.
 *
 * A grep is a poor substitute for a type system, but this particular hole is
 * not one the type system can see.
 */

function sourceFiles(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, ext);
    return ext.some((e) => entry.name.endsWith(e)) ? [full] : [];
  });
}

const MARKUP = sourceFiles('src', ['.tsx']);

// Colour is checked across .ts as well: a helper that returns a colour string
// would bypass the rule just as effectively as a component that inlines one.
const ALL_SOURCE = sourceFiles('src', ['.tsx', '.ts']).filter((f) => !f.endsWith('.test.ts'));

describe('every button declares its type', () => {
  it('finds files to check at all', () => {
    // Guards the guard: a broken walk would make everything below pass.
    expect(MARKUP.length).toBeGreaterThan(8);
    expect(ALL_SOURCE.length).toBeGreaterThan(MARKUP.length);
  });

  it('leaves no <button> defaulting to submit', () => {
    const offenders: string[] = [];

    for (const file of MARKUP) {
      const source = readFileSync(file, 'utf8');
      const openingTag = /<button\b([\s\S]*?)>/g;
      let match: RegExpExecArray | null;

      while ((match = openingTag.exec(source))) {
        if (/\btype=/.test(match[1])) continue;
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line}`);
      }
    }

    expect(offenders, `add type="button" (or type="submit") at:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });
});

describe('the colour law holds in the markup', () => {
  it('writes no colour value outside tokens.css', () => {
    // The single rule that keeps a seven-phase build from looking like seven
    // apps. Components reference tokens; they never name a colour.
    const offenders: string[] = [];

    for (const file of ALL_SOURCE) {
      const source = readFileSync(file, 'utf8');

      for (const [i, line] of source.split('\n').entries()) {
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !line.includes('//')) {
          offenders.push(`${file}:${i + 1} — hex literal`);
        }
        if (/\b(bg|text|border|fill|stroke)-\[/.test(line)) {
          offenders.push(`${file}:${i + 1} — arbitrary Tailwind colour`);
        }
        if (/\b(rgb|rgba|hsl|hsla)\(/.test(line)) {
          offenders.push(`${file}:${i + 1} — literal colour function`);
        }
      }
    }

    expect(offenders, `colour values belong in tokens.css:\n${offenders.join('\n')}`).toEqual([]);
  });
});

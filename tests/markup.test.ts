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

/**
 * Prose is never rendered in the uppercase caption style.
 *
 * This bug has now arrived three times from three unrelated places: the
 * captured wording on the triage screen, the raw text of a food entry, and
 * every input hint in the app at once, because `Field` put its hint slot in
 * `type-caption`. The design system reserves that style for "urgency labels,
 * metadata (uppercase)"; running a sentence through it both shouts and breaks
 * the sentence-case copy rule.
 *
 * It matters most in exactly the places it is least visible. "2 OTHER THINGS
 * ARE HIDDEN. THEY KEEP." is the low-battery footer — the one screen written
 * for the worst day — and the whole point of that copy is that it does not
 * raise its voice.
 *
 * `type-note` is the correct home for small prose. Fixing an instance is not
 * fixing the class, so this fails the build instead.
 *
 * Limit worth stating: only authored text is checked. Content that is entirely
 * an interpolation is skipped, because "7:57 p.m. · ai" and "45 min" are
 * genuine metadata and belong in `type-caption`. A sentence assembled wholly
 * inside a template literal would slip through.
 */
/** Removes every balanced {...} region, leaving only authored text. */
function stripBraces(input: string): string {
  let depth = 0;
  let out = '';
  for (const ch of input) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
    if (ch === '{' || ch === '}') out += ' ';
  }
  return out;
}

describe('prose is not rendered in the uppercase caption style', () => {
  it('leaves no sentence in type-caption', () => {
    const offenders: string[] = [];

    for (const file of MARKUP) {
      const source = readFileSync(file, 'utf8');
      const element =
        /<(\w+)[^>]*className=(?:"|\{`)[^"`]*\btype-caption\b[^"`]*(?:"|`\})[^>]*>([\s\S]*?)<\/\1>/g;

      for (const match of source.matchAll(element)) {
        const body = match[2];
        if (/<\w/.test(body)) continue; // nested elements; not a text node

        // Drop interpolations entirely: what remains is what a person wrote.
        // Braces nest — `{cond && ` · ${x}`}` — so this counts depth rather
        // than pattern-matching, which would strip the inner pair and leave
        // the outer one behind as text.
        const authored = stripBraces(body).replace(/\s+/g, ' ').trim();
        if (!authored) continue;

        const words = authored.split(' ').filter(Boolean).length;
        const endsASentence = /[a-z]\.$/.test(authored);
        const containsASentenceBreak = /[a-z]\. [A-Z]/.test(authored);

        if (words >= 5 || endsASentence || containsASentenceBreak) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${file}:${line} — ${authored}`);
        }
      }
    }

    expect(offenders, 'use type-note for prose; type-caption is for labels').toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { departures, mergePresence } from '../src/lib/usePresence';

/**
 * Rule 12: every tap that changes something is animated, noticeably.
 *
 * The bug that set the rule was invisible in code review: ticking work off on
 * Today removed it from the open list in the same render, React unmounted the
 * row, and it simply vanished. Nothing failed and every type was right. These
 * guards catch the three shapes that produced cuts across the app.
 */

function sourceFiles(dir: string, ext: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, ext);
    return ext.some((e) => entry.name.endsWith(e)) ? [full] : [];
  });
}

const CSS = sourceFiles('src', ['.css']);
const MARKUP = sourceFiles('src', ['.tsx']);

/** The body of every `@media (prefers-reduced-motion: reduce)` block. */
function reducedBlocks(css: string): string[] {
  const out: string[] = [];
  const head = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

/** A duration short enough to be a cut rather than an animation. */
function cutsMotion(block: string): boolean {
  return /(transition|animation)-duration\s*:\s*(0(\.\d+)?m?s|1ms)\b/.test(block);
}

/**
 * Components that render a Sheet, and the places that show one conditionally
 * (`{x && (<Editor …/>)}`) without SheetPresence around it — which removes the
 * sheet before it can animate out.
 */
function unwrappedSheets(files: { path: string; source: string }[]): string[] {
  const sheetOwners = new Set(
    files
      .filter((f) => /<Sheet\b/.test(f.source))
      .flatMap((f) => [...f.source.matchAll(/export function (\w+)|^function (\w+)/gm)].map((m) => m[1] ?? m[2])),
  );
  sheetOwners.add('Sheet');
  const offenders: string[] = [];
  for (const { path, source } of files) {
    const shown = /\{[^{}\n]*&&\s*\(\s*<(\w+)\b/g;
    let m: RegExpExecArray | null;
    while ((m = shown.exec(source))) {
      if (!sheetOwners.has(m[1])) continue;
      const before = source.slice(Math.max(0, m.index - 80), m.index);
      if (/<SheetPresence>\s*$/.test(before)) continue;
      offenders.push(`${path}:${source.slice(0, m.index).split('\n').length} <${m[1]}>`);
    }
  }
  return offenders;
}

describe('Reduce Motion fades instead of cutting', () => {
  it('finds stylesheets with reduced-motion blocks at all', () => {
    expect(CSS.length).toBeGreaterThan(1);
    expect(CSS.flatMap((f) => reducedBlocks(readFileSync(f, 'utf8'))).length).toBeGreaterThan(3);
  });

  it('catches a planted cut', () => {
    const planted = '@media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; } }';
    expect(reducedBlocks(planted).some(cutsMotion)).toBe(true);
    expect(cutsMotion('.x { animation-duration: 1ms; }')).toBe(true);
    expect(cutsMotion('.x { animation: none; }')).toBe(false);
  });

  it('never shortens a transition or animation to nothing', () => {
    const offenders = CSS.filter((f) => reducedBlocks(readFileSync(f, 'utf8')).some(cutsMotion));
    expect(offenders).toEqual([]);
  });
});

describe('sheets leave as well as arrive', () => {
  const files = MARKUP.map((path) => ({ path, source: readFileSync(path, 'utf8') }));

  it('catches a planted bare sheet', () => {
    const planted = [
      { path: 'a.tsx', source: 'export function Editor() { return <Sheet open title="x" /> }' },
      { path: 'b.tsx', source: 'return <div>{open && (\n  <Editor />\n)}</div>' },
      { path: 'c.tsx', source: 'return <SheetPresence>\n{open && (\n  <Editor />\n)}</SheetPresence>' },
    ];
    expect(unwrappedSheets(planted)).toEqual(['b.tsx:1 <Editor>']);
  });

  it('wraps every conditionally shown sheet in SheetPresence', () => {
    expect(unwrappedSheets(files)).toEqual([]);
  });

  it('keeps Sheet mounted while it closes', () => {
    const sheet = readFileSync('src/components/Sheet.tsx', 'utf8');
    expect(sheet).not.toMatch(/if \(!open\) return null/);
  });
});

describe('presence keeps a leaving item where it was', () => {
  const key = (s: string) => s;

  it('finds what left and where', () => {
    expect([...departures(['a', 'b', 'c'], ['a', 'c'], key)]).toEqual([['b', { item: 'b', index: 1 }]]);
    expect(departures(['a'], ['a', 'b'], key).size).toBe(0);
  });

  it('puts a leaving item back at its index, marked leaving', () => {
    const merged = mergePresence(['a', 'c'], key, new Map([['b', { item: 'b', index: 1 }]]));
    expect(merged.map((p) => `${p.key}${p.leaving ? '*' : ''}`)).toEqual(['a', 'b*', 'c']);
  });

  it('keeps two departures in their original order', () => {
    const merged = mergePresence(
      ['d'],
      key,
      new Map([
        ['c', { item: 'c', index: 2 }],
        ['a', { item: 'a', index: 0 }],
      ]),
    );
    expect(merged.map((p) => p.key)).toEqual(['a', 'd', 'c']);
  });

  it('puts the last item back at the end when the list empties', () => {
    const merged = mergePresence([], key, new Map([['z', { item: 'z', index: 4 }]]));
    expect(merged).toEqual([{ item: 'z', key: 'z', leaving: true }]);
  });
});

describe('Today and low-battery work leave through presence', () => {
  it('renders both work lists from usePresence', () => {
    for (const f of ['src/routes/Today.tsx', 'src/routes/LowBattery.tsx']) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).toMatch(/usePresence\(/);
      expect(s, f).not.toMatch(/data\.assignments\.map\(/);
    }
  });
});

describe('a cancelled animation is not an error', () => {
  // Animation.finished rejects with an AbortError when the animation is
  // cancelled, which happens every time a tap interrupts one. `.finally()`
  // passes that rejection on, so it surfaced as an uncaught page error.
  const bad = /\.finished\.finally\(/;

  it('catches a planted one', () => {
    expect(bad.test('void a.finished.finally(() => el.remove());')).toBe(true);
    expect(bad.test('void a.finished.then(done, done);')).toBe(false);
  });

  it('never chains finally onto an animation', () => {
    const offenders = sourceFiles('src', ['.ts', '.tsx']).filter((f) => bad.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

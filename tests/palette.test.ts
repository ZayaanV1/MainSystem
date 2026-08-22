import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Structural guards on the palette itself.
 *
 * The colour law separates four systems, and until now the only mechanical
 * guard was "no colour literal outside tokens.css" — which stops a hex code
 * escaping but says nothing about whether the values inside the file still
 * mean four distinct things.
 *
 * They stopped meaning four distinct things once the brand became a colour.
 * Burnt orange landed in the middle of the old warm urgency ramp, and the
 * first phthalo green landed five degrees from the protein ring. Both were
 * invisible reading the file and obvious the moment the numbers were
 * computed, which is exactly the class of bug this project keeps finding by
 * measuring rather than assuming.
 *
 * So the separations are asserted, not remembered. If someone nudges a token
 * later and quietly collapses two systems into one, the build says so.
 */

const TOKENS = readFileSync('src/styles/tokens.css', 'utf8');

/** The value of a token as declared in the FIRST (dark, :root) block. */
function token(name: string): string {
  const m = new RegExp(`^\\s*--${name}:\\s*(#[0-9a-fA-F]{6});`, 'm').exec(TOKENS);
  if (!m) throw new Error(`token --${name} not found, or is not a 6-digit hex`);
  return m[1];
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h =
    max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return h < 0 ? h + 360 : h;
}

/** Shortest distance around the wheel, so 350 and 10 are 20 apart. */
function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return d > 180 ? 360 - d : d;
}

/** Saturation as max-minus-min: how much colour, independent of how light. */
function chroma(hex: string): number {
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MACROS = ['m-calories', 'm-protein', 'm-carbs', 'm-fat'];

describe('the token file is readable at all', () => {
  it('parses the tokens these assertions depend on', () => {
    // Guards the guard: a regex that stopped matching would make every
    // assertion below vacuously pass.
    expect(token('accent')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(token('accent-2')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(MACROS.map(token)).toHaveLength(4);
  });
});

describe('the brand stays clear of the macro rings', () => {
  /**
   * The requirement that produced the blue-shade phthalo. The brand had to
   * clear every macro WITHOUT any macro moving, so the constraint binds on
   * --accent-2 and never on --m-*.
   *
   * Fifteen degrees is the floor. Protein sits at nineteen, which is the
   * tightest pair in the palette and the reason --accent-2 is 184 degrees
   * rather than the 170 of a yellow-shade phthalo.
   */
  it.each(MACROS)('phthalo is at least 15 degrees from --%s', (macro) => {
    expect(hueGap(token('accent-2'), token(macro))).toBeGreaterThanOrEqual(15);
  });

  it.each(MACROS)('the readable phthalo is at least 15 degrees from --%s', (macro) => {
    // -lit is the variant that appears as text and thin marks, which is
    // where a hue collision would actually be read.
    expect(hueGap(token('accent-2-lit'), token(macro))).toBeGreaterThanOrEqual(15);
  });

  it('ember is nowhere near a macro either', () => {
    for (const macro of MACROS) {
      expect(hueGap(token('accent'), token(macro))).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('the urgency ramp is a ramp', () => {
  const STEPS = ['t-approaching', 't-urgent', 't-critical', 't-overdue'] as const;

  it('holds one hue across every dated step', () => {
    // The point of the single-hue ramp: five steps of the same colour read as
    // a progression, five different hues read as five unrelated colours. If a
    // step drifts more than 20 degrees off the top of the ramp it has become
    // its own colour again.
    for (const step of STEPS) {
      expect(hueGap(token(step), token('t-overdue'))).toBeLessThanOrEqual(20);
    }
  });

  it('climbs in chroma toward the deadline', () => {
    // Chroma, not lightness. The first version of this test asserted
    // lightness and failed, correctly: in a narrow rose band above a 4.5:1
    // floor, raising saturation LOWERS relative luminance, so the two cannot
    // both climb. Lightness is also the wrong axis — a ramp that climbs in
    // lightness makes its quiet end harder to read than its loud end, and
    // "due in two weeks" is not less important to be able to read.
    const cs = STEPS.map((s) => chroma(token(s)));
    for (let i = 1; i < cs.length; i++) {
      expect(cs[i]).toBeGreaterThan(cs[i - 1]);
    }
  });

  it('reads at the same strength at every step', () => {
    // The corollary of ramping on chroma: readability must NOT vary. If these
    // ever spread apart, the ramp has quietly become a lightness ramp and the
    // least urgent label has become the hardest to read.
    const rs = STEPS.map((s) => contrast(token(s), token('ink-800')));
    expect(Math.max(...rs) - Math.min(...rs)).toBeLessThan(0.75);
  });

  it('keeps --t-distant off the ramp', () => {
    // "Three weeks away" is not a quiet emergency. The least urgent state is
    // deliberately colourless and must not creep onto the rose axis.
    expect(hueGap(token('t-distant'), token('t-overdue'))).toBeGreaterThan(45);
  });

  it('never reaches pure red', () => {
    // Rule 4. A rose keeps a blue component; pure red does not.
    for (const step of [...STEPS, 't-distant']) {
      const [r, g, b] = rgb(token(step));
      expect(b).toBeGreaterThan(0.15);
      expect(r - b).toBeLessThan(0.85);
    }
  });
});

describe('every colour that carries text can be read', () => {
  const GROUND = () => token('ink-900');
  const SURFACE = () => token('ink-800');

  it.each(['text-hi', 'text-mid', 'text-low'])('--%s clears 4.5:1 on both grounds', (name) => {
    expect(contrast(token(name), GROUND())).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(name), SURFACE())).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['t-distant', 't-approaching', 't-urgent', 't-critical', 't-overdue', 't-done'])(
    '--%s clears 4.5:1 as a label',
    (name) => {
      // Every urgency state carries a written label, so the whole ramp is a
      // text colour and the 3:1 mark floor does not apply to any of it. Three
      // values in the first draft passed as marks and failed as text.
      expect(contrast(token(name), SURFACE())).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('both brand fills carry their own foreground', () => {
    expect(contrast(token('accent'), token('on-accent'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('accent-2'), token('on-accent-2'))).toBeGreaterThanOrEqual(4.5);
  });

  it('the readable phthalo is actually readable', () => {
    // --accent-2 itself is a dark fill at roughly 2:1 on the ground and can
    // never be text. -lit exists for exactly that, and if it ever stops
    // clearing the floor the fallback is invisible text on the app ground.
    expect(contrast(token('accent-2-lit'), token('ink-900'))).toBeGreaterThanOrEqual(4.5);
  });
});

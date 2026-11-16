import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Text set straight on the Glass theme's photograph.
 *
 * `palette.test.ts` holds every text token to 4.5:1 on the opaque grounds, and
 * it passed while secondary text on the wallpaper measured 2.3 to 3.7:1 on the
 * live build (15 Nov 2026): a photograph is not a ground a token can be
 * checked against. What can be held is the decision that fixed it. On the
 * room every text step is the brightest one and wears a cushion; a panel puts
 * the steps back.
 */

const css = readFileSync('src/styles/vision.css', 'utf8');
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('text on the Glass room', () => {
  const room = rule(":root[data-look='glass']:not([data-v-bg='off']) [data-recede]");
  const panel = rule(":root[data-look='glass'] [data-recede] :is(.mat, .v-card, .well, .lgroup, .fold, .compact-bar)");

  it('uses the brightest text step for every step, with a cushion', () => {
    expect(room).toContain('--text-mid: var(--text-hi);');
    expect(room).toContain('--text-low: var(--text-hi);');
    expect(room).toMatch(/text-shadow:[^;]*var\(--room-halo\)/u);
  });

  it('gives a panel its own steps back', () => {
    expect(panel).toContain('--text-mid: var(--panel-text-mid);');
    expect(panel).toContain('--text-low: var(--panel-text-low);');
    expect(panel).toContain('text-shadow: none;');
  });

  it('defines the cushion for the dark room and both ways into the light one', () => {
    expect(tokens.match(/--room-halo:/gu)?.length).toBe(3);
  });

  it('leaves the very-clear-glass shadow the last word on a panel', () => {
    expect(css.indexOf('[data-recede] :is(.mat')).toBeLessThan(css.indexOf("[data-v-clear='high'] :is(.mat"));
  });
});

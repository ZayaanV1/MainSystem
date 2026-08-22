/**
 * ActivityRings — concentric macro rings.
 *
 * Adapted from KokonutUI's "Apple Activity Card", which is the one component
 * in that library that answers a question this app actually asks: how do four
 * quantities against four targets read as a single glance rather than four
 * readings. Their version is copied here in structure only — the concentric
 * nesting, the rounded caps, the draw-on — because everything else about it
 * (its colours, its Tailwind arbitrary values, its hardcoded three rings) is
 * incompatible with the colour law.
 *
 * WHY THIS EXISTS ALONGSIDE Ring, RATHER THAN REPLACING IT
 *
 * They answer different questions and both are needed. `Ring` answers "how is
 * protein doing" — it carries the target BAND, the over-arc and the written
 * status, and it is the right thing on the diet screen where a number is
 * being interrogated. This answers "how is today doing", where the useful
 * signal is the shape of four arcs together and no single one is being read
 * closely. Collapsing the two would mean either four bands stacked
 * concentrically, which is unreadable, or dropping the band from the diet
 * screen, which would reintroduce the false precision Ring exists to avoid.
 *
 * Rings are ordered outside-in by the order given. Put the macro being
 * managed most closely first: the outer ring has the most arc length per unit
 * and is the easiest to read.
 */

import { useLayoutEffect, useRef } from 'react';
import { animate, utils } from 'animejs';

export interface ActivityRing {
  /** Token name, e.g. '--m-protein'. Never a literal colour. */
  colorVar: string;
  label: string;
  value: number;
  /** Top of the scale. A full circle. */
  max: number;
  unit?: string;
}

interface ActivityRingsProps {
  rings: ActivityRing[];
  size?: number;
  /** Stroke of each ring. Gaps between rings are derived from this. */
  stroke?: number;
  /**
   * The written values beside the rings.
   *
   * On by default and it should stay on: the colour law says every ring
   * carries a written value, and four nested arcs are exactly the case where
   * the geometry alone stops being readable. It is a prop only because Today
   * renders the same rings under a heading that already lists them.
   */
  readout?: boolean;
}

const EASE = 'cubicBezier(0.2, 0, 0, 1)';

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ActivityRings({
  rings,
  size = 148,
  stroke = 11,
  readout = true,
}: ActivityRingsProps) {
  const arcsRef = useRef<SVGCircleElement[]>([]);
  const mounted = useRef(false);

  const centre = size / 2;
  // Each ring sits one stroke plus a hairline gap inside the last, so the
  // arcs stay separable where they overlap at the twelve o'clock start.
  const gap = stroke * 0.42;
  const radii = rings.map((_, i) => centre - stroke / 2 - i * (stroke + gap));

  const clamp = (n: number) => Math.max(0, Math.min(1, n));

  /**
   * The arcs draw on once, then track their value with a CSS transition.
   *
   * Same division of labour as Ring: anime.js choreographs the arrival
   * (staggered, outside-in, so the four rings read as one object assembling
   * rather than four things appearing at once), and the compositor handles
   * every change after that. Running the JS loop on every log would spend a
   * frame budget to look identical.
   */
  useLayoutEffect(() => {
    const arcs = arcsRef.current.filter(Boolean);
    if (arcs.length === 0) return;

    const targets = arcs.map((el) => {
      const full = Number(el.dataset.circumference ?? 0);
      const frac = Number(el.dataset.fraction ?? 0);
      return { el, dash: `${frac * full} ${full}`, full };
    });

    if (mounted.current) return;
    mounted.current = true;

    if (reduced()) {
      // Present and complete, just not animated into being.
      for (const t of targets) utils.set(t.el, { strokeDasharray: t.dash });
      return;
    }

    for (const t of targets) utils.set(t.el, { strokeDasharray: `0 ${t.full}` });

    // One call per arc rather than one call over all of them: each arc has a
    // different end value, and anime's per-target function form types the
    // callback as an easing function for CSS properties. A loop with an
    // explicit delay says the same thing and survives a library type change.
    targets.forEach((t, i) => {
      animate(t.el, {
        strokeDasharray: t.dash,
        duration: 900,
        delay: i * 70,
        ease: EASE,
      });
    });
  }, [rings]);

  arcsRef.current = [];

  return (
    <div className="flex items-center gap-5">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={rings
          .map(
            (r) =>
              `${r.label}: ${Math.round(r.value).toLocaleString('en-CA')}${
                r.unit ? ` ${r.unit}` : ''
              } of ${Math.round(r.max).toLocaleString('en-CA')}`,
          )
          .join('. ')}
        className="shrink-0"
      >
        <g transform={`rotate(-90 ${centre} ${centre})`} fill="none">
          {rings.map((ring, i) => {
            const r = radii[i];
            const c = 2 * Math.PI * r;
            const frac = clamp(ring.value / ring.max);
            return (
              <g key={ring.label}>
                <circle
                  cx={centre}
                  cy={centre}
                  r={r}
                  stroke="var(--ink-600)"
                  strokeWidth={stroke}
                />
                <circle
                  ref={(el) => {
                    if (el) arcsRef.current[i] = el;
                  }}
                  data-circumference={c}
                  data-fraction={frac}
                  cx={centre}
                  cy={centre}
                  r={r}
                  stroke={`var(${ring.colorVar})`}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${frac * c} ${c}`}
                  style={{
                    transition: 'stroke-dasharray var(--dur-ring) var(--ease-out)',
                  }}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {readout && (
        <dl className="flex min-w-0 flex-col gap-2">
          {rings.map((ring) => (
            <div key={ring.label} className="flex items-baseline gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: `var(${ring.colorVar})` }}
              />
              <dt className="type-label text-text-mid">{ring.label}</dt>
              <dd className="type-label text-text-hi tabular-nums">
                {Math.round(ring.value).toLocaleString('en-CA')}
                <span className="text-text-low">
                  {' / '}
                  {Math.round(ring.max).toLocaleString('en-CA')}
                  {ring.unit ? ` ${ring.unit}` : ''}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

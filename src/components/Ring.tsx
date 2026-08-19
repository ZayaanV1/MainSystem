/**
 * Ring — the signature element.
 *
 * One component, two uses: the four macro rings and daily-checklist
 * completion. One visual idea, learned once.
 *
 * The thing that makes this ring different from every other progress ring is
 * the TARGET BAND. Macro targets are ranges — 160-175g of protein, not 168 —
 * and collapsing a range to its midpoint invents a precision that was never
 * there, then quietly grades you against it. So the band renders as a lighter
 * arc spanning the acceptable range, and being anywhere inside it is success.
 *
 * Over-target continues as a second, thinner arc in the same hue. Over is
 * information, not failure. It never turns red — there is no red.
 *
 * Colour comes in as a token name and is never hardcoded. Macro colours belong
 * on rings and nowhere else; urgency colours never appear here.
 */

import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Motion is imported for the entrance only.
 *
 * The arc itself stays a CSS transition on stroke-dasharray. That transition
 * is the receipt that an entry landed, it already runs on the compositor, and
 * handing it to a JS animation loop would spend a frame budget to look
 * identical. Motion earns its place on the things CSS cannot spring: the
 * scale-and-settle when a ring first appears.
 */
interface RingProps {
  value: number;
  /** Top of the scale. A full circle. For macros, the top of the target band. */
  max: number;
  /** The acceptable range, drawn as a lighter arc. */
  band?: { min: number; max: number };
  /** Token name, e.g. '--m-protein'. Never a literal colour. */
  colorVar: string;
  label: string;
  unit?: string;
  size?: number;
  stroke?: number;
  /** Written form of the target, e.g. '160-175 g'. Shown under the value. */
  targetLabel?: string;
  /**
   * Makes the ring a button.
   *
   * Optional because this component is also the daily-checklist ring, which
   * is a readout and not a control. A ring that looks tappable everywhere but
   * only responds in one place is worse than one that never invites the tap.
   */
  onClick?: () => void;
}

export function Ring({
  value,
  max,
  band,
  colorVar,
  label,
  unit,
  size = 132,
  stroke = 10,
  targetLabel,
  onClick,
}: RingProps) {
  // Respected everywhere. Someone who has asked the OS for less motion has
  // asked this app too, and a spring that ignores it is the app overruling a
  // system setting it does not own.
  const reduced = useReducedMotion();

  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const centre = size / 2;

  // One gradient per ring per mount. Two rings sharing an id would silently
  // paint the second with the first's colours, and the bug looks like a
  // palette mistake rather than a duplicate identifier.
  const gradientId = useId().replace(/:/g, '');

  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const frac = clamp(value / max);
  const overFrac = value > max ? clamp((value - max) / max) : 0;

  const bandStart = band ? clamp(band.min / max) : 0;
  const bandEnd = band ? clamp(band.max / max) : 0;

  const inBand = band ? value >= band.min && value <= band.max : false;

  // A written value accompanies every ring, so colour is never the only
  // signal — which is also the colourblind-safety answer.
  const readout = `${Math.round(value).toLocaleString('en-CA')}${unit ? ` ${unit}` : ''}`;
  const status = band
    ? inBand
      ? 'in range'
      : value > band.max
        ? `${Math.round(value - band.max)} over`
        : `${Math.round(band.min - value)} to go`
    : undefined;

  const Root = onClick ? motion.button : motion.div;

  return (
    <Root
      initial={reduced ? false : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      {...(onClick
        ? {
            type: 'button' as const,
            onClick,
            // The label already reads the whole state aloud; this says what
            // the tap will do, which the visual affordance cannot.
            'aria-label': `${label}: ${readout}${status ? `, ${status}` : ''}. Show what made this up.`,
          }
        : {})}
      className="flex flex-col items-center gap-2"
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          {...(onClick
            ? { 'aria-hidden': true }
            : {
                role: 'img',
                'aria-label': `${label}: ${readout}${targetLabel ? ` of ${targetLabel}` : ''}${
                  status ? `, ${status}` : ''
                }`,
              })}
        >
          <defs>
            {/*
              The arc runs base to lighter along its own length, which is what
              stops a thick stroke reading as a flat band. Both stops are the
              same hue: a gradient that drifted in hue would make two rings
              ambiguous where they overlap.
            */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={`var(${colorVar})`} />
              <stop offset="100%" stopColor={`var(${colorVar}-lit, var(${colorVar}))`} />
            </linearGradient>
          </defs>

          {/* Rotated so every arc starts at twelve o'clock. */}
          <g transform={`rotate(-90 ${centre} ${centre})`} fill="none">
            <circle
              cx={centre}
              cy={centre}
              r={r}
              stroke="var(--ink-600)"
              strokeWidth={stroke}
            />

            {band && (
              <circle
                cx={centre}
                cy={centre}
                r={r}
                stroke={`var(${colorVar})`}
                strokeWidth={stroke}
                // Legible enough to locate at a glance without competing with
                // the value arc drawn over it.
                strokeOpacity={0.32}
                strokeDasharray={`${(bandEnd - bandStart) * c} ${c}`}
                strokeDashoffset={-bandStart * c}
              />
            )}

            <circle
              cx={centre}
              cy={centre}
              r={r}
              stroke={`url(#${gradientId})`}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${frac * c} ${c}`}
              // The one place motion does real work: the ring visibly moving
              // is the receipt that the entry landed.
              style={{
                transition: 'stroke-dasharray var(--dur-ring) var(--ease-out)',
              }}
            />

            {overFrac > 0 && (
              <circle
                cx={centre}
                cy={centre}
                r={r - stroke}
                stroke={`var(${colorVar})`}
                strokeWidth={stroke / 2.5}
                strokeLinecap="round"
                strokeDasharray={`${overFrac * 2 * Math.PI * (r - stroke)} ${
                  2 * Math.PI * (r - stroke)
                }`}
                style={{
                  transition: 'stroke-dasharray var(--dur-ring) var(--ease-out)',
                }}
              />
            )}
          </g>
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="type-display text-text-hi">
            {Math.round(value).toLocaleString('en-CA')}
          </span>
          {unit && <span className="type-caption text-text-low">{unit}</span>}
        </div>
      </div>

      <div className="text-center">
        <div className="type-label text-text-hi">{label}</div>
        {targetLabel && <div className="type-caption text-text-low">{targetLabel}</div>}

        {/* Written, not just drawn. When the value arc nearly fills the ring,
            the band becomes a sliver and "am I in range" stops being readable
            from the geometry alone. This is also the colourblind-safety
            answer, so it is not a separate accommodation. */}
        {status && <div className="type-caption mt-1 text-text-mid">{status}</div>}
      </div>
    </Root>
  );
}

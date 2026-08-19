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
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const centre = size / 2;

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

  const Root = onClick ? 'button' : 'div';

  return (
    <Root
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
              stroke={`var(${colorVar})`}
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

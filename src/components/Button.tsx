import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Button.
 *
 * Three variants and no more. `primary` is the one action a screen wants you
 * to take; `secondary` is everything else; `quiet` is for actions that must be
 * available but must not compete — undo, dismiss, "not now".
 *
 * COLOUR
 *
 * `primary` is ember and nothing else in the app is. That is the whole reason
 * the palette has a brand colour: "the orange thing" means "the thing to
 * press" without a legend, on every screen, permanently. It is also why ember
 * may never state a status — the moment a deadline is orange, the rule stops
 * being learnable.
 *
 * `secondary` is phthalo, the second brand colour. It is deliberately a fill
 * rather than an outline, because the app has a lot of two-action screens and
 * an outlined secondary next to a filled primary reads as disabled.
 *
 * There is still no destructive variant, because there is still no colour for
 * one. Pure red does not exist in this app, and borrowing --t-overdue for a
 * delete button would put an urgency colour somewhere it means nothing.
 *
 * MOTION
 *
 * Every variant carries `fx-depth`: lifts under a cursor, sinks under a
 * finger. The press half is the one that matters, because hover does not fire
 * on a phone and that is where this app is mostly used. Callers that want the
 * heavier treatments pass them in `className` — `fx-glass` for the single hero
 * control on a screen with `atmosphere` behind it, `fx-magnet` with
 * useMagnetic() for a capture action.
 */

type Variant = 'primary' | 'secondary' | 'quiet';

/**
 * `sm` is not a smaller button — it is a smaller LABEL on a control that keeps
 * the full 44px tap target. Shrinking the target to match the text is how a
 * dense screen becomes unusable with a thumb, and this app has several.
 */
type Size = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  // The gradient runs light to deep down the face, which is what stops a
  // large flat fill reading as a coloured rectangle. Both stops are the same
  // hue — a gradient that drifted in hue would make the brand ambiguous.
  primary:
    'border-transparent text-on-accent bg-linear-to-b from-accent-lit via-accent to-accent-deep',
  secondary:
    'border-transparent text-on-accent-2 bg-linear-to-b from-accent-2-mid via-accent-2 to-accent-2-deep',
  // Quiet, not invisible. A fully transparent button on a dark ground is
  // indistinguishable from a label until you happen to tap it, and a control
  // should not have to be discovered. This still yields to `primary`.
  quiet: 'bg-ink-800 text-text-mid border-ink-600',
};

const SIZES: Record<Size, string> = {
  md: 'px-5 type-label',
  // Caption type, pill padding, and the same min-height as everything else.
  sm: 'px-3 type-caption',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  full = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // HTML defaults a button inside a form to type="submit". That silently
      // turned every secondary action in a form — Delete, Cancel, Remove —
      // into a save, which is the opposite of what it said on the label. The
      // safe default is inert; submitting is opted into explicitly.
      type={type}
      {...rest}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-pill border',
        SIZES[size],
        // 44px comes from the base layer; this keeps the label centred in it.
        'min-h-[var(--tap)]',
        'fx-depth',
        'disabled:opacity-50',
        VARIANTS[variant],
        full ? 'w-full' : '',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

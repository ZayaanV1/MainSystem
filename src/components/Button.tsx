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
 * Every variant scales in place under a finger and brightens under a real
 * pointer. It never moves: a hover lift that a tap also fires, followed by a
 * press dip, is the jitter a phone showed as "shaking when clicked". Callers
 * that want a heavier treatment pass it in `className` — `fx-magnet` with
 * useMagnetic() for a capture action on a desktop.
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

/*
 * The faces live in material.css (.btn-primary, .btn-secondary, .btn-quiet),
 * alongside the panels and chips they are drawn to match: a lit top edge, a
 * gradient that runs light to deep down the face, and a glow in the button's
 * own colour underneath. Ember is still the only colour on a control that
 * means "press this".
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  quiet: 'btn-quiet',
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
        // Presses scale in place and never translate; see material.css for
        // why a translate here was the "shake when clicked" on a phone.
        'btn',
        SIZES[size],
        VARIANTS[variant],
        full ? 'w-full' : '',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

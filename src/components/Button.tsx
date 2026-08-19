import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Button.
 *
 * Three variants and no more. `primary` is the one action a screen wants you
 * to take; `secondary` is everything else; `quiet` is for actions that must be
 * available but must not compete — undo, dismiss, "not now".
 *
 * There is no destructive variant, because there is no colour for one. Pure
 * red does not exist in this app, and borrowing --t-overdue for a delete
 * button would put an urgency colour somewhere it means nothing.
 */

type Variant = 'primary' | 'secondary' | 'quiet';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-text-hi text-ink-900 border-transparent',
  secondary: 'bg-ink-700 text-text-hi border-ink-600',
  // Quiet, not invisible. A fully transparent button on a dark ground is
  // indistinguishable from a label until you happen to tap it, and a control
  // should not have to be discovered. This still yields to `primary`.
  quiet: 'bg-ink-800 text-text-mid border-ink-600',
};

export function Button({
  variant = 'secondary',
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
        'inline-flex items-center justify-center gap-2 rounded-pill border px-5',
        'type-label transition-colors duration-150 ease-out',
        // 44px comes from the base layer; this keeps the label centred in it.
        'min-h-[var(--tap)]',
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

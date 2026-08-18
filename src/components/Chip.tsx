import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Chip.
 *
 * A small pill: a course tag, a filter, a one-tap re-log. When a course dot is
 * shown it is 6px and it is a dot — never a fill behind the text, per the
 * colour law.
 *
 * Renders as a button when given an onClick, and as a span otherwise, so a
 * decorative chip is not announced as interactive.
 */

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** A course token name, e.g. '--c-3'. Renders as a 6px dot. */
  courseVar?: string;
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function Chip({
  courseVar,
  selected = false,
  onClick,
  className = '',
  children,
  ...rest
}: ChipProps) {
  const classes = [
    'inline-flex items-center gap-2 rounded-pill border px-3 py-2 type-label',
    selected ? 'border-text-mid bg-ink-700 text-text-hi' : 'border-ink-600 text-text-mid',
    onClick ? 'transition-colors duration-150 ease-out' : '',
    className,
  ].join(' ');

  const dot = courseVar ? (
    <span
      aria-hidden
      className="h-1.5 w-1.5 shrink-0 rounded-pill"
      style={{ backgroundColor: `var(${courseVar})` }}
    />
  ) : null;

  if (!onClick) {
    return (
      <span className={classes} {...(rest as object)}>
        {dot}
        {children}
      </span>
    );
  }

  return (
    <button
      // Same trap as Button: a bare button inside a form defaults to
      // type="submit", so tapping a filter or a date shortcut submitted the
      // form instead of setting the value. Inert by default.
      type="button"
      {...rest}
      onClick={onClick}
      aria-pressed={selected}
      className={`${classes} min-h-[var(--tap)]`}
    >
      {dot}
      {children}
    </button>
  );
}

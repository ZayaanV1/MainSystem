import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

/**
 * Chip.
 *
 * A small pill: a course tag, a filter, a one-tap re-log. A course chip
 * carries its course as a 6px dot, and when SELECTED it lights in the
 * course's colour — a translucent wash inside a rim, the same cloisonné the
 * Week view's blocks use, under text that keeps full contrast.
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
  // Glass, with a rim; a selected course chip lights in its course's colour
  // (material.css). The dot glows faintly in that colour either way.
  const classes = ['chip', className].join(' ');
  const tint = courseVar
    ? ({ '--b': `var(${courseVar}-rgb)` } as CSSProperties)
    : undefined;

  const dot = courseVar ? <span aria-hidden className="chip-dot" /> : null;

  if (!onClick) {
    return (
      <span
        className={classes}
        data-block={courseVar ? true : undefined}
        style={tint}
        {...(rest as object)}
      >
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
      data-block={courseVar ? true : undefined}
      style={{ ...tint, ...rest.style }}
      className={classes}
    >
      {dot}
      {children}
    </button>
  );
}

import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Card.
 *
 * A surface. Optionally carries a course mark — a 3px left edge, per the
 * colour law. Course colour marks; it never fills, and it never appears
 * anywhere else on the card.
 */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** A course token name, e.g. '--c-3'. Renders as the left edge. */
  courseVar?: string;
  children: ReactNode;
}

export function Card({ courseVar, className = '', children, style, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      style={{
        ...style,
        ...(courseVar ? { borderLeftColor: `var(${courseVar})` } : {}),
      }}
      className={[
        'rounded-card bg-ink-800',
        courseVar ? 'border-l-[3px]' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

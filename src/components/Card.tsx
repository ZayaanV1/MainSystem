import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Card.
 *
 * A surface. Optionally carries a course mark — a 3px left edge, per the
 * colour law. Course colour marks; it never fills, and it never appears
 * anywhere else on the card.
 *
 * SHAPE AND DEPTH ARE HIERARCHY, NOT DECORATION
 *
 * A flat background step reads as competent; nothing in the app told the eye
 * which surface mattered more than another one it sat directly beside. Three
 * elevations exist for exactly that reason, and they are meant to disagree in
 * frequency: `flat` (the default — most of a screen) should always outnumber
 * `raised`, and a screen should never carry more than one or two `hero`
 * cards, because a page where everything floats is a page where nothing
 * does. `hero` also swaps the radius family, which is the cheaper and more
 * reliable signal — a shape difference reads before a shadow does, and reads
 * in a screenshot as well as it does in the browser.
 */

type Elevation = 'flat' | 'raised' | 'hero';

const ELEVATION: Record<Elevation, string> = {
  flat: 'rounded-card border border-ink-600 bg-ink-800',
  raised: 'rounded-card border border-ink-600 bg-ink-800 shadow-md',
  hero: 'rounded-hero border border-ink-600 bg-ink-800 shadow-lg',
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** A course token name, e.g. '--c-3'. Renders as the left edge. */
  courseVar?: string;
  /** @default 'flat' */
  elevation?: Elevation;
  children: ReactNode;
}

export function Card({
  courseVar,
  elevation = 'flat',
  className = '',
  children,
  style,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      style={{
        ...style,
        ...(courseVar ? { borderLeftColor: `var(${courseVar})` } : {}),
      }}
      className={[ELEVATION[elevation], courseVar ? 'border-l-[3px]' : '', className].join(' ')}
    >
      {children}
    </div>
  );
}

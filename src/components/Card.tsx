import type { ComponentProps, CSSProperties, ReactNode } from 'react';

/**
 * Card.
 *
 * A surface. Optionally belongs to a course, in which case it is that
 * course's glass: a translucent wash and a rim in its colour, under text that
 * keeps full contrast (tests/palette.test.ts measures it).
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

/*
 * All three are the same material (material.css .mat): glass lit from the top
 * left, a rim that catches the light at two corners, and a glow the surface
 * sits in. They differ in how far they are lifted, and `hero` in shape.
 */
const ELEVATION: Record<Elevation, string> = {
  flat: 'mat',
  raised: 'mat mat-raised',
  hero: 'mat mat-hero',
};

interface CardProps extends ComponentProps<'div'> {
  /** A course token name, e.g. '--c-3'. The card becomes that course's glass. */
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
      data-block={courseVar ? true : undefined}
      style={{
        ...style,
        ...(courseVar ? ({ '--b': `var(${courseVar}-rgb)` } as CSSProperties) : {}),
      }}
      className={[ELEVATION[elevation], className].join(' ')}
    >
      {children}
    </div>
  );
}

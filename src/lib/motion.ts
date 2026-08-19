import { animate, createDrawable, stagger, utils } from 'animejs';

/**
 * The app's animation vocabulary, in one file.
 *
 * Two libraries with two jobs, kept apart on purpose. Motion is declarative
 * and lives in components: entrances, the rail's sliding indicator, anything
 * tied to React state. anime.js is imperative and lives here: SVG choreography
 * and number counting, which are the things React is a clumsy way to express.
 *
 * Every function below no-ops when the reader has asked for reduced motion.
 * That check belongs here rather than at each call site, because the one call
 * site that forgets is the bug.
 */

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** House easing. The same curve as --ease-out, so CSS and JS agree. */
const EASE = 'cubicBezier(0.2, 0, 0, 1)';

/**
 * Draws an SVG path on, as if written.
 *
 * Used for the trend line. A chart that simply appears is a picture; a chart
 * that draws left to right is the shape of the last few weeks happening in
 * order, which is what the line actually means.
 */
export function drawPath(target: SVGPathElement | SVGPathElement[], duration = 900) {
  const paths = Array.isArray(target) ? target : [target];
  if (paths.length === 0) return;

  if (reduced()) {
    // Present and complete, just not animated into being.
    utils.set(paths, { strokeDashoffset: 0 });
    return;
  }

  return animate(createDrawable(paths), {
    draw: '0 1',
    duration,
    // Segments follow each other rather than racing, so a line broken by a
    // week with no weigh-in still reads left to right.
    delay: stagger(140),
    ease: EASE,
  });
}

/**
 * Counts a number up to its value.
 *
 * Only on first arrival. Re-running it on every change would mean a number
 * that is never quite readable while you are reading it, and the ring beside
 * it already reports change.
 */
export function countUp(
  el: HTMLElement,
  to: number,
  options: { duration?: number; format?: (n: number) => string } = {},
) {
  const format = options.format ?? ((n: number) => String(Math.round(n)));

  if (reduced()) {
    el.textContent = format(to);
    return;
  }

  const state = { value: 0 };
  return animate(state, {
    value: to,
    duration: options.duration ?? 800,
    ease: EASE,
    onUpdate: () => {
      el.textContent = format(state.value);
    },
  });
}

/**
 * Brings a list in, one item after another.
 *
 * Kept short and shallow. A long stagger on a list of work turns "what is due"
 * into a thing you wait for, and this screen exists to answer that instantly.
 */
export function revealList(items: HTMLElement[], options: { each?: number } = {}) {
  if (items.length === 0) return;

  if (reduced()) {
    utils.set(items, { opacity: 1, translateY: 0 });
    return;
  }

  return animate(items, {
    opacity: [0, 1],
    translateY: [6, 0],
    duration: 320,
    delay: stagger(options.each ?? 28),
    ease: EASE,
  });
}

/**
 * A short pulse on a value that just changed.
 *
 * For the moment a ring's number moves because something was logged: the
 * receipt that the tap landed. Scale only — no colour, because colour here is
 * carrying meaning already.
 */
export function pulse(el: HTMLElement) {
  if (reduced()) return;

  return animate(el, {
    scale: [1, 1.06, 1],
    duration: 420,
    ease: EASE,
  });
}

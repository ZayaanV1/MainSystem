/**
 * View transitions between screens.
 *
 * The browser takes a snapshot of the page before the state change and another
 * after it, then cross-fades between them as real compositor layers. Nothing
 * stays mounted, nothing needs an exit animation, and there is no presence
 * library holding dead screens alive at opacity zero — which is exactly the
 * failure that made this app abandon AnimatePresence and settle for an
 * entrance-only fade.
 *
 * So this is the fix for a compromise, not a decoration on top of one. The
 * screens now leave as well as arrive, and they leave in the direction you
 * travelled.
 *
 * DIRECTION IS THE POINT
 *
 * A cross-fade says "something changed". A slide says "you moved, and this is
 * which way". Moving right along the nav pushes the old screen left; moving
 * back pulls it right. The nav order is the app's only spatial model and this
 * is the one place it is expressed.
 *
 * GRACEFUL EVERYWHERE
 *
 * `startViewTransition` does not exist in Firefox or in Safari before 18. The
 * fallback is not a lesser animation — it is the state change happening
 * immediately, which is what the app did before this file existed. Nothing is
 * gated on it and nothing breaks without it.
 */

type Direction = 'forward' | 'back' | 'none';

/**
 * The API is already declared on Document in current TypeScript DOM libs, but
 * not in every version this may be built with, and it is absent at RUNTIME in
 * Firefox and in Safari before 18. So the type is taken from the lib where it
 * exists and the presence check stays a real runtime check either way — the
 * two are unrelated problems and conflating them is how a feature detect ends
 * up trusting a type declaration.
 */
type MaybeViewTransitions = {
  startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
};

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Runs `apply` inside a view transition when the browser can, and plainly
 * when it cannot.
 *
 * `direction` is written to the document element so the CSS can choose which
 * way the screens travel; it is cleared when the transition finishes so a
 * later transition never inherits the last one's direction.
 */
export function withTransition(apply: () => void, direction: Direction = 'none'): void {
  const doc = document as unknown as Document & MaybeViewTransitions;

  // Reduced motion still gets a transition — the CSS collapses it to a plain
  // cross-fade rather than removing it. Cutting instantly between two full
  // screens is its own kind of jarring, and a fade is not vestibular motion.
  if (typeof doc.startViewTransition !== 'function') {
    apply();
    return;
  }

  doc.documentElement.dataset.transition = reduced() ? 'fade' : direction;

  const transition = doc.startViewTransition(apply);
  void transition.finished.finally(() => {
    delete doc.documentElement.dataset.transition;
  });
}

/**
 * Which way to travel, given where you were and where you are going.
 *
 * `order` is the nav order. Anything not in it — a search screen reached from
 * a keyboard shortcut, settings opened from a menu — has no position on the
 * bar and therefore no direction, so it fades rather than pretending to a
 * place in a sequence it is not part of.
 */
export function directionBetween<T>(order: readonly T[], from: T, to: T): Direction {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1 || a === b) return 'none';
  return b > a ? 'forward' : 'back';
}

import { animate, stagger, utils } from 'animejs';

/**
 * The app's animation vocabulary, in one file.
 *
 * Two libraries with two jobs, kept apart on purpose. Motion is declarative
 * and lives in components: entrances, the rail's sliding indicator, anything
 * tied to React state. anime.js is imperative and lives here: SVG choreography
 * and staggered sequences, which are the things React is a clumsy way to express.
 *
 * Under Reduce Motion nothing here is skipped. Rule 12: a tap that changes
 * something is always animated, so travel is removed and the change is shown
 * as a fade instead. That check belongs here rather than at each call site,
 * because the one call site that forgets is the bug.
 *
 * The functions added for rule 12 (exitRow, measureBelow, closeUp, clearTick)
 * use the Web Animations API directly: the browser plays them, so they keep
 * their shape while the screen is busy re-rendering the list they belong to.
 */

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** House easing. The same curve as --ease-out, so CSS and JS agree. */
const EASE = 'cubicBezier(0.2, 0, 0, 1)';

/**
 * Brings a list in, one item after another.
 *
 * Kept short and shallow. A long stagger on a list of work turns "what is due"
 * into a thing you wait for, and this screen exists to answer that instantly.
 */
export function revealList(items: HTMLElement[], options: { each?: number } = {}) {
  if (items.length === 0) return;

  if (reduced()) {
    items.forEach((el) => fade(el, 0, 1));
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
  if (reduced()) {
    fade(el, 0.4, 1);
    return;
  }

  return animate(el, {
    scale: [1, 1.06, 1],
    duration: 420,
    ease: EASE,
  });
}

/**
 * Draws a tick on, once, at the moment something is marked done.
 *
 * This is feedback, not celebration. The distinction matters here because the
 * spec bans praise that ACCUMULATES — streak counters, "best week yet", the
 * things that become losable and then become the reason not to open the app.
 * Warmth in the moment is explicitly allowed, and a mark that appears
 * instantly is indistinguishable from a mark that was already there. The draw
 * is what makes it read as "you just did that".
 *
 * The box overshoots and settles while the tick draws over it, so the two read
 * as one gesture rather than as two effects that happened to fire together.
 *
 * Nothing runs on the way back. Un-ticking clears the mark with no animation,
 * because an undo that performs is an undo that feels like a penalty, and
 * changing your mind must stay free.
 */
export function drawTick(path: SVGPathElement, box?: HTMLElement) {
  if (reduced()) {
    utils.set(path, { strokeDashoffset: 0 });
    if (box) fade(box, 0.3, 1);
    return;
  }

  const length = path.getTotalLength();
  utils.set(path, { strokeDasharray: length, strokeDashoffset: length });

  if (box) {
    animate(box, {
      // Kept small. A 0.72 -> 1.12 pop read as a wobble on a phone, beside
      // every other thing that moved under a tap; this is a settle, not a bounce.
      scale: [0.86, 1.04, 1],
      duration: 300,
      // Overshoot lives in the keyframes rather than in the easing, so the
      // settle is a real deceleration instead of a bounce curve fighting it.
      ease: EASE,
    });
  }

  return animate(path, {
    strokeDashoffset: 0,
    duration: 300,
    // Starts a beat after the box begins to grow, so the mark lands INTO a
    // shape that is already there rather than racing it.
    delay: 90,
    ease: EASE,
  });
}

/* ============================================================================
   Rule 12: every tap that changes something is animated.
   ========================================================================= */

const EASE_OUT_CSS = 'cubic-bezier(0.2, 0, 0, 1)';
/** Leaving accelerates away: what is gone should get out of the way. */
const EASE_EXIT_CSS = 'cubic-bezier(0.4, 0, 1, 1)';
/** Travel that settles, for a list closing up. */
const EASE_GLIDE_CSS = 'cubic-bezier(0.32, 0.72, 0, 1)';

function run(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof el.animate !== 'function') return null;
  try {
    return el.animate(keyframes, options);
  } catch {
    return null;
  }
}

function fade(el: Element, from: number, to: number) {
  return run(el, [{ opacity: from }, { opacity: to }], { duration: 240, easing: 'ease-out' });
}

export type ExitKind = 'done' | 'defer' | 'gone';

/**
 * Takes a row off the screen. Resolves when it is gone.
 *
 * Done leaves to the right, the way a swipe finishes it, after a beat that
 * lets the tick land; tomorrow leaves to the left; anything removed by
 * something other than a tap simply recedes. The animation holds its last
 * frame, so the row stays invisible until the list drops it.
 */
export function exitRow(el: HTMLElement, kind: ExitKind): Promise<void> {
  const anim = reduced()
    ? run(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: kind === 'done' ? 200 : 0, easing: 'ease-out', fill: 'forwards' })
    : run(
        el,
        [
          { opacity: 1, transform: 'none' },
          {
            opacity: 0,
            transform:
              kind === 'done' ? 'translateX(44px) scale(0.98)' : kind === 'defer' ? 'translateX(-44px) scale(0.98)' : 'scale(0.96)',
          },
        ],
        { duration: 220, delay: kind === 'done' ? 260 : 0, easing: EASE_EXIT_CSS, fill: 'forwards' },
      );
  if (!anim) return Promise.resolve();
  return anim.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** Undoes exitRow when the row comes back before it has gone. */
export function returnRow(el: HTMLElement) {
  el.getAnimations().forEach((a) => a.cancel());
  run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT_CSS });
}

/**
 * Where everything below an element sits now: its later siblings, then the
 * later siblings of each ancestor, up to the screen. Taken just before the
 * element is removed, so closeUp can move them from here to where they land.
 */
export function measureBelow(el: HTMLElement): Map<HTMLElement, number> {
  const out = new Map<HTMLElement, number>();
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node.tagName !== 'MAIN') {
    let sib = node.nextElementSibling as HTMLElement | null;
    while (sib) {
      out.set(sib, sib.getBoundingClientRect().top);
      sib = sib.nextElementSibling as HTMLElement | null;
    }
    node = node.parentElement;
  }
  return out;
}

/**
 * The list closes up as a cascade, each element a beat after the one above
 * it, rather than everything below the gap jumping at once.
 */
export function closeUp(first: Map<HTMLElement, number>) {
  let i = 0;
  for (const [el, top] of first) {
    if (!el.isConnected) continue;
    const dy = top - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.5) continue;
    if (reduced()) continue;
    run(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
      duration: 420,
      delay: Math.min(i++, 8) * 14,
      easing: EASE_GLIDE_CSS,
      fill: 'backwards',
    });
  }
}

/**
 * Un-ticking. Changing your mind must stay free, so this is quick and quiet,
 * but it is not a cut: the ring settles back from slightly large.
 */
export function clearTick(box: HTMLElement) {
  if (reduced()) {
    fade(box, 0.4, 1);
    return;
  }
  run(box, [{ transform: 'scale(1.14)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], {
    duration: 240,
    easing: EASE_OUT_CSS,
  });
}

/** A number or label that just changed: it rises into place. */
export function settleIn(el: HTMLElement) {
  if (reduced()) {
    fade(el, 0, 1);
    return;
  }
  run(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
    duration: 260,
    easing: EASE_OUT_CSS,
  });
}

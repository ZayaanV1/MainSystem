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

/* ============================================================================
   Navigation and capture.
   ========================================================================= */

/** Settles with a small overshoot: confirmation only (the tick, the punch). */
const EASE_SETTLE_CSS = 'cubic-bezier(0.34, 1.45, 0.64, 1)';

/**
 * Moves the lit capsule behind the current tab to `target`.
 *
 * It travels like a drop of liquid: stretching toward where it is going,
 * then gathering. It starts from wherever it is drawn now, so tapping a
 * second tab mid-flight turns it around instead of restarting it.
 */
export function moveCapsule(lit: HTMLElement, target: HTMLElement | null, axis: 'x' | 'y' = 'x') {
  if (!target) {
    run(lit, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
    return;
  }
  const along = axis === 'x' ? target.offsetLeft : target.offsetTop;
  const size = axis === 'x' ? target.offsetWidth : target.offsetHeight;
  const now = getComputedStyle(lit).transform;
  const m = now && now !== 'none' ? new DOMMatrixReadOnly(now) : null;
  const from = m ? (axis === 'x' ? m.m41 : m.m42) : null;
  const wasHidden = lit.style.opacity === '0' || from === null;

  lit.getAnimations().forEach((a) => a.cancel());
  if (axis === 'x') lit.style.width = `${size}px`;
  else lit.style.height = `${size}px`;
  const move = (v: number) => (axis === 'x' ? `translateX(${v}px)` : `translateY(${v}px)`);
  const scale = (s: number) => (axis === 'x' ? `scaleX(${s})` : `scaleY(${s})`);
  lit.style.transform = move(along);
  lit.style.opacity = '1';

  if (wasHidden || from === null || Math.abs(from - along) < 1) {
    if (wasHidden) settleIn(lit);
    return;
  }
  if (reduced()) {
    fade(lit, 0.3, 1);
    return;
  }
  const stretch = 1 + Math.min(0.45, (Math.abs(along - from) / size) * 0.16);
  run(
    lit,
    [
      { transform: `${move(from)} ${scale(1)}` },
      { transform: `${move(from + (along - from) * 0.55)} ${scale(stretch)}`, offset: 0.4 },
      { transform: `${move(along)} ${scale(1)}` },
    ],
    { duration: 440, easing: EASE_GLIDE_CSS },
  );
}

/** A tab's icon as it becomes the current place: it settles into the capsule. */
export function popIcon(el: Element | null) {
  if (!el) return;
  if (reduced()) {
    fade(el, 0.4, 1);
    return;
  }
  run(el, [{ transform: 'scale(0.8) translateY(2px)' }, { transform: 'none' }], { duration: 420, easing: EASE_SETTLE_CSS });
}

/** A small surface opening from the control that summoned it, and closing back into it. */
export function popOpen(el: HTMLElement | null, origin = '100% 100%') {
  if (!el) return;
  el.style.transformOrigin = origin;
  if (reduced()) {
    fade(el, 0, 1);
    return;
  }
  run(el, [{ opacity: 0, transform: 'scale(0.94) translateY(8px)' }, { opacity: 1, transform: 'none' }], {
    duration: 380,
    easing: EASE_GLIDE_CSS,
  });
}

export function popClose(el: HTMLElement | null): Promise<void> {
  if (!el) return Promise.resolve();
  const anim = reduced()
    ? run(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' })
    : run(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96) translateY(6px)' }], {
        duration: 170,
        easing: EASE_EXIT_CSS,
        fill: 'forwards',
      });
  return anim ? anim.finished.then(() => undefined, () => undefined) : Promise.resolve();
}

/**
 * Captured words leave the field as a ghost that drops toward the inbox,
 * so sending is something you see happen rather than a field going blank.
 */
export function dropGhost(input: HTMLInputElement, text: string) {
  const r = input.getBoundingClientRect();
  const cs = getComputedStyle(input);
  const ghost = document.createElement('span');
  ghost.textContent = text;
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed',
    zIndex: '60',
    left: `${r.left + parseFloat(cs.paddingLeft)}px`,
    top: `${r.top}px`,
    height: `${r.height}px`,
    lineHeight: `${r.height}px`,
    maxWidth: `${r.width - parseFloat(cs.paddingLeft) - 64}px`,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
    color: cs.color,
    pointerEvents: 'none',
  });
  document.body.append(ghost);
  const anim = reduced()
    ? run(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-out', fill: 'forwards' })
    : run(ghost, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(22px) scale(0.94)', opacity: 0 }], {
        duration: 320,
        easing: 'cubic-bezier(0.4, 0, 0.9, 0.6)',
        fill: 'forwards',
      });
  if (!anim) ghost.remove();
  else void anim.finished.finally(() => ghost.remove());
}

/** A short receipt that appears, holds, and fades by itself. */
export function flashReceipt(el: HTMLElement | null, holdMs = 1600) {
  if (!el) return;
  el.getAnimations().forEach((a) => a.cancel());
  run(
    el,
    reduced()
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
      : [
          { opacity: 0, transform: 'translateY(-4px)' },
          { opacity: 1, transform: 'none', offset: 0.12 },
          { opacity: 1, transform: 'none', offset: 0.85 },
          { opacity: 0, transform: 'none' },
        ],
    { duration: holdMs + 500, easing: 'ease-out', fill: 'forwards' },
  );
}

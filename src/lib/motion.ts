/**
 * The app's animation vocabulary, in one file.
 *
 * No animation library. Everything here hands the browser keyframes through
 * the Web Animations API, so the browser plays them: they keep their shape
 * while a screen is busy rendering, and Safari does not hold them to the 60
 * frames a second it allows JavaScript-driven animation. Motion and anime.js
 * did that work before Phase B, and both are gone.
 *
 * The named curves live in tokens.css (--ease-*) and are mirrored below, with
 * a test that keeps the two in step.
 *
 * Under Reduce Motion nothing here is skipped. Rule 12: a tap that changes
 * something is always animated, so travel is removed and the change is shown
 * as a fade instead. That check belongs here rather than at each call site,
 * because the one call site that forgets is the bug.
 */

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The named curves, as in tokens.css. */
export const EASE = {
  out: 'cubic-bezier(0.2, 0, 0, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  glide: 'cubic-bezier(0.32, 0.72, 0, 1)',
  settle: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
  drift: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

/**
 * Brings a list in, one item after another.
 *
 * Kept short and shallow. A long stagger on a list of work turns "what is due"
 * into a thing you wait for, and this screen exists to answer that instantly.
 */
export function revealList(items: HTMLElement[], options: { each?: number } = {}) {
  if (items.length === 0) return;
  const each = options.each ?? 28;
  items.slice(0, 10).forEach((el, i) => {
    if (reduced()) {
      fade(el, 0, 1);
      return;
    }
    run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay: i * each, easing: EASE.out, fill: 'backwards' });
    run(el, [{ transform: 'translateY(12px) scale(0.99)' }, { transform: 'none' }], {
      duration: 520,
      delay: i * each,
      easing: EASE.drift,
      fill: 'backwards',
    });
  });
}

/**
 * A short pulse on a value that just changed: the receipt that the tap
 * landed. Scale only — no colour, because colour here is carrying meaning.
 */
export function pulse(el: HTMLElement) {
  if (reduced()) {
    fade(el, 0.4, 1);
    return;
  }
  run(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], {
    duration: 420,
    easing: EASE.out,
  });
}

/**
 * Draws a tick on, once, at the moment something is marked done.
 *
 * This is feedback, not celebration. The spec bans praise that ACCUMULATES —
 * streak counters, "best week yet" — while warmth in the moment is allowed,
 * and a mark that appears instantly is indistinguishable from one that was
 * already there. The draw is what makes it read as "you just did that".
 *
 * The box settles while the tick draws over it, so the two read as one
 * gesture. The overshoot is in the keyframes and kept small: a 0.72 -> 1.12
 * pop read as a wobble on a phone.
 */
export function drawTick(path: SVGPathElement, box?: HTMLElement) {
  if (reduced()) {
    if (box) fade(box, 0.3, 1);
    return;
  }
  const length = path.getTotalLength();
  if (box) {
    run(box, [{ transform: 'scale(0.86)' }, { transform: 'scale(1.04)', offset: 0.6 }, { transform: 'none' }], {
      duration: 300,
      easing: EASE.out,
    });
  }
  // Starts a beat after the box begins to grow, so the mark lands INTO a
  // shape that is already there rather than racing it.
  run(
    path,
    [
      { strokeDasharray: `${length}`, strokeDashoffset: `${length}` },
      { strokeDasharray: `${length}`, strokeDashoffset: '0' },
    ],
    { duration: 300, delay: 90, easing: EASE.out, fill: 'backwards' },
  );
}

/* ============================================================================
   Rule 12: every tap that changes something is animated.
   ========================================================================= */

const EASE_OUT_CSS = EASE.out;
/** Leaving accelerates away: what is gone should get out of the way. */
const EASE_EXIT_CSS = EASE.exit;
/** Travel that settles, for a list closing up. */
const EASE_GLIDE_CSS = EASE.glide;

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
const EASE_SETTLE_CSS = EASE.settle;

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
  else void anim.finished.then(
      () => ghost.remove(),
      () => ghost.remove(),
    );
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

/**
 * Finishing a ticket: the stub is punched and the punched-out disc falls away
 * under gravity, tumbling. Feedback that the tap landed, which the copy rules
 * allow; nothing bigger, which they do not.
 */
export function punchTicket(hole: HTMLElement) {
  if (reduced()) {
    fade(hole, 0, 1);
    return;
  }
  run(hole, [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 420, easing: EASE_SETTLE_CSS });
  const r = hole.getBoundingClientRect();
  if (r.width === 0) return;
  const chad = document.createElement('span');
  chad.className = 'chad';
  chad.setAttribute('aria-hidden', 'true');
  Object.assign(chad.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.append(chad);
  const drift = (Math.random() * 2 - 1) * 18;
  const spin = (Math.random() * 2 - 1) * 240;
  const fall = run(
    chad,
    [
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${drift * 0.4}px, -6px) rotate(${spin * 0.2}deg)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${drift}px, 86px) rotate(${spin}deg) scale(0.7)`, opacity: 0 },
    ],
    { duration: 640, easing: 'cubic-bezier(0.45, 0, 0.85, 0.4)', fill: 'forwards' },
  );
  if (!fall) chad.remove();
  else void fall.finished.then(
      () => chad.remove(),
      () => chad.remove(),
    );
}

/* ============================================================================
   Sheets: the page recedes, the title flies.
   ========================================================================= */

const SHEET_EASE = EASE.glide;
const SHEET_MS = 420;
const RECEDE = 0.94;

let receded: { el: HTMLElement; ox: number; oy: number; depth: number } | null = null;

/**
 * The page behind a sheet sinks back a little, so the sheet reads as lifted
 * toward you rather than painted on top. Only the content column moves: the
 * tab bar is fixed, and a fixed element inside a transformed one would be
 * fixed to it instead of to the screen.
 */
export function recedePage() {
  if (receded) {
    receded.depth++;
    return;
  }
  const el = document.querySelector<HTMLElement>('[data-recede]');
  if (!el || reduced()) return;
  const r = el.getBoundingClientRect();
  const ox = window.innerWidth / 2;
  const oy = window.innerHeight / 2;
  el.style.transformOrigin = `${ox - r.left}px ${oy - r.top}px`;
  receded = { el, ox, oy, depth: 1 };
  el.getAnimations().forEach((a) => a.cancel());
  run(el, [{ transform: 'none' }, { transform: `scale(${RECEDE})` }], { duration: SHEET_MS, easing: SHEET_EASE, fill: 'forwards' });
}

export function restorePage() {
  if (!receded) return;
  if (--receded.depth > 0) return;
  const { el } = receded;
  receded = null;
  const now = getComputedStyle(el).transform;
  el.getAnimations().forEach((a) => a.cancel());
  const back = run(el, [{ transform: now === 'none' ? `scale(${RECEDE})` : now }, { transform: 'none' }], {
    duration: 320,
    easing: SHEET_EASE,
  });
  if (back) void back.finished.then(
      () => (el.style.transformOrigin = ''),
      () => (el.style.transformOrigin = ''),
    );
}

/** Where a point on the receded page will be once the page is back at full size. */
function unrecede(rect: DOMRect): { left: number; top: number; height: number } {
  const r = receded;
  if (!r) return { left: rect.left, top: rect.top, height: rect.height };
  return {
    left: r.ox + (rect.left - r.ox) / RECEDE,
    top: r.oy + (rect.top - r.oy) / RECEDE,
    height: rect.height / RECEDE,
  };
}

/**
 * The words you tapped travel into the sheet's title as it rises, on the
 * sheet's own curve so the two land together; closing sends them home.
 * `panel` is the sheet, measured where it will settle rather than where its
 * entrance starts.
 */
export function flyText(src: HTMLElement, dst: HTMLElement, panel: HTMLElement, dir: 'in' | 'out') {
  if (reduced()) return;
  const a = src.getBoundingClientRect();
  if (a.width === 0 || a.bottom < 0 || a.top > window.innerHeight) return;
  let b: { left: number; top: number; height: number };
  if (dir === 'in') {
    const d = dst.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const settledTop = window.innerHeight - panel.offsetHeight;
    b = { left: d.left, top: settledTop + (d.top - p.top), height: d.height };
  } else {
    b = unrecede(dst.getBoundingClientRect());
  }
  const cs = getComputedStyle(src);
  const k = parseFloat(getComputedStyle(dst).fontSize) / parseFloat(cs.fontSize);
  const clone = document.createElement('span');
  clone.textContent = src.textContent;
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {
    position: 'fixed',
    zIndex: '70',
    left: `${a.left}px`,
    top: `${a.top}px`,
    width: `${a.width}px`,
    margin: '0',
    transformOrigin: '0 0',
    pointerEvents: 'none',
    color: cs.color,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    letterSpacing: cs.letterSpacing,
    lineHeight: cs.lineHeight,
    textDecoration: 'none',
  });
  document.body.append(clone);
  src.style.visibility = 'hidden';
  dst.style.visibility = 'hidden';
  const flight = run(
    clone,
    [{ transform: 'none' }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${k})` }],
    dir === 'in'
      ? { duration: SHEET_MS, easing: SHEET_EASE, fill: 'forwards' }
      : { duration: 300, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'forwards' },
  );
  const land = () => {
    src.style.visibility = '';
    dst.style.visibility = '';
    run(dst, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
    const fade = run(clone, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' });
    if (fade) void fade.finished.then(
      () => clone.remove(),
      () => clone.remove(),
    );
    else clone.remove();
  };
  if (flight) void flight.finished.then(land, land);
  else land();
}

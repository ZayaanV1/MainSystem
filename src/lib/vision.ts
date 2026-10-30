import { useMediaQuery } from './useMediaQuery';
import { usePreferences } from './preferences';

/**
 * Vision on a desk: the theme's own layout.
 *
 * Vision is a theme like the others on a phone and an upright iPad. From
 * 64rem, where the rail would appear, it swaps the rail for a floating dock
 * and a top bar, Today becomes a dashboard, and screens dissolve into one
 * another the way the glass dashboard it is drawn from does (Oct 2026).
 */
export const DESK = '(min-width: 64rem)';

export function useVisionDesk(): boolean {
  const { skin } = usePreferences();
  const desk = useMediaQuery(DESK);
  return skin === 'vision' && desk;
}

function visionDesk(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.dataset.skin === 'vision' &&
    typeof matchMedia === 'function' &&
    matchMedia(DESK).matches
  );
}

const still = () =>
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
  document.documentElement.dataset.motion === 'calm';

/** The curve every Vision entrance and exit uses: fast out, long settle. */
export const VISION_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

let leaving: Animation | null = null;

/**
 * Change screen after the current one has blurred away, on Vision's desk.
 *
 * Everywhere else, and with reduced or calm motion, the change is immediate.
 * A second change asked for mid-exit lands at once rather than queueing, so
 * fast clicking along the dock never waits on an animation.
 */
export function leaveThen(apply: () => void): void {
  const page = document.querySelector<HTMLElement>('[data-recede] .page-enter');
  if (!visionDesk() || still() || !page || typeof page.animate !== 'function') {
    apply();
    return;
  }
  if (leaving) {
    leaving.cancel();
    leaving = null;
    apply();
    return;
  }
  const anim = page.animate(
    [
      { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
      { opacity: 0, filter: 'blur(14px)', transform: 'scale(0.985)' },
    ],
    { duration: 280, easing: VISION_EASE, fill: 'forwards' },
  );
  leaving = anim;
  let ran = false;
  const done = () => {
    if (ran) return;
    ran = true;
    if (leaving === anim) leaving = null;
    apply();
  };
  void anim.finished.then(done, done);
  // A hidden tab never finishes an animation; the screen must still change.
  setTimeout(done, 400);
}

/**
 * Number the surfaces of a screen so they rise in order, on Vision's desk.
 * The CSS reads --i; nothing is animated from JavaScript.
 */
export function cascade(root: HTMLElement | null): (() => void) | undefined {
  if (!root || !visionDesk()) return;
  let n = 0;
  const number = () => {
    for (const el of root.querySelectorAll<HTMLElement>('.mat, .v-card')) {
      if (el.dataset.rise) continue;
      el.dataset.rise = '';
      // A panel that arrives with the data, after the first paint, still takes
      // its turn rather than landing with the first.
      el.style.setProperty('--i', String(Math.min(n++, 14)));
    }
  };
  number();
  // Screens fill in as their data lands; number those panels too, for the
  // first moments only, so a later edit never replays an entrance.
  const watch = new MutationObserver(number);
  watch.observe(root, { childList: true, subtree: true });
  const stop = setTimeout(() => watch.disconnect(), 2500);
  return () => {
    clearTimeout(stop);
    watch.disconnect();
  };
}

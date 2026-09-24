import { useEffect, useRef, useState } from 'react';

/**
 * Pull down at the top of a screen to reload it.
 *
 * The app is installed to a home screen, where there is no address bar and
 * therefore no reload button. Without this the only way to force fresh data is
 * to force-quit — which is what people actually do, and it costs them the
 * offline cache and any half-typed capture.
 *
 * WHY IT ONLY ARMS AT SCROLL ZERO
 *
 * The gesture is a downward drag, which is also how you scroll up. Arming it
 * anywhere else would mean flicking back to the top of a long list ends in an
 * unwanted refresh. So it only starts when the page is already at the very top
 * AND the finger moves down — a scroll that reaches the top mid-gesture does
 * not retroactively become a pull.
 *
 * WHY THE PULL IS DAMPED
 *
 * The indicator moves at a third of the finger's speed and stops entirely at
 * the threshold. Following one-to-one makes the gesture feel loose and, worse,
 * makes the threshold invisible — the resistance IS the affordance, and it is
 * how you know without being told that you have pulled far enough.
 *
 * Touch only, for the same reason as swipe: a desktop has a reload and a
 * trackpad has overscroll behaviour of its own.
 */

const ARM_TOP_PX = 2;
/*
 * How far a finger must travel, mostly downward, before this counts as a pull
 * at all. There was no dead zone, and a fingertip is never still: the 1-3px it
 * drifts during an ordinary TAP was read as a pull, so at the top of Today —
 * which is where the screen usually is — every tap nudged the whole page down
 * a pixel, flashed "Pull to refresh" and sprang it back. That was the screen
 * shaking under every tap. Twelve pixels is past any tap and well short of a
 * deliberate pull.
 */
const DEAD_ZONE_PX = 12;
const TRIGGER_PX = 64;
const DAMPING = 3;
const MAX_PX = 80;

export function usePullToRefresh(onRefresh: () => Promise<unknown> | void) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const active = useRef(false);
  // Past the dead zone and committed to being a pull.
  const engaged = useRef(false);
  // Read by touchend. As state in the effect's dependencies, every pixel of
  // pull tore the listeners down and put them back mid-gesture.
  const pullRef = useRef(0);

  // Read through a ref so the listeners can stay attached for the life of the
  // component. Re-subscribing on every render of a callback that changes each
  // time would drop a gesture mid-pull.
  const handler = useRef(onRefresh);
  handler.current = onRefresh;

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (refreshing) return;
      // Only at the very top. See the note above: this is what stops a flick
      // back to the top of a list turning into a refresh.
      if (window.scrollY > ARM_TOP_PX) return;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      active.current = true;
      engaged.current = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (!active.current || startY.current === null) return;

      const delta = e.touches[0].clientY - startY.current;
      const sideways = Math.abs(e.touches[0].clientX - startX.current);

      if (!engaged.current) {
        // A tap, or not yet enough to tell. Nothing moves.
        if (delta < DEAD_ZONE_PX && sideways < DEAD_ZONE_PX) return;
        // Upward, or more sideways than down: a scroll or a swipe, not a pull.
        if (delta <= 0 || sideways > delta) {
          active.current = false;
          return;
        }
        engaged.current = true;
      }

      if (delta <= DEAD_ZONE_PX) {
        // Pulled back up past the start: abandon rather than tracking a
        // negative, so the gesture cannot flip into a scroll halfway.
        pullRef.current = 0;
        setPull(0);
        active.current = false;
        engaged.current = false;
        return;
      }
      const next = Math.min(MAX_PX, (delta - DEAD_ZONE_PX) / DAMPING);
      pullRef.current = next;
      setPull(next);
    }

    async function onTouchEnd() {
      const travelled = pullRef.current;
      const wasPull = engaged.current;
      active.current = false;
      engaged.current = false;
      startY.current = null;

      if (!wasPull) return;

      if (travelled < TRIGGER_PX / DAMPING) {
        pullRef.current = 0;
        setPull(0);
        return;
      }

      // Held at the threshold while the work happens, so the spinner has
      // somewhere to be and the release does not read as a cancel.
      setRefreshing(true);
      setPull(TRIGGER_PX / DAMPING);
      try {
        await handler.current();
      } finally {
        setRefreshing(false);
        pullRef.current = 0;
        setPull(0);
      }
    }

    // Passive: this never calls preventDefault, so it must not tell the
    // browser it might. Blocking the scroll thread on a listener that only
    // reads is how a list becomes janky.
    const opts = { passive: true } as const;
    window.addEventListener('touchstart', onTouchStart, opts);
    window.addEventListener('touchmove', onTouchMove, opts);
    window.addEventListener('touchend', onTouchEnd, opts);
    window.addEventListener('touchcancel', onTouchEnd, opts);

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [refreshing]);

  return {
    /** Distance the indicator should sit at, already damped. */
    pull,
    refreshing,
    /** True once releasing would refresh. */
    armed: pull >= TRIGGER_PX / DAMPING,
  };
}

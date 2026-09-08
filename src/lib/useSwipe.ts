import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * Swipe a row sideways to act on it.
 *
 * Completing and deferring are the two highest-frequency actions in the app
 * and both currently need a precise tap on a small target, or opening the
 * item. On a phone, held one-handed, that is the difference between clearing
 * a list on the bus and deciding to do it later.
 *
 * WHY A THRESHOLD AND NOT A HAIR TRIGGER
 *
 * A row that fires on any horizontal movement fires while you are scrolling,
 * and an app that randomly completes your work is worse than one that never
 * offered the gesture. So: nothing happens until the finger has travelled a
 * real distance, and the direction is committed on the first few pixels —
 * once a gesture is judged vertical it stays a scroll for its whole life, even
 * if the finger wanders.
 *
 * WHY IT NEVER ACTS ON RELEASE ALONE
 *
 * The action fires only if the row is still past the threshold when the finger
 * lifts. Dragging out and back is a cancel, which is the only undo a gesture
 * can offer without a toast — and it is discoverable by accident, which is the
 * best kind.
 *
 * MOUSE POINTERS ARE IGNORED
 *
 * A desktop user has the buttons, which are clearer and already there. Swipe
 * on a trackpad also competes with two-finger back-navigation in every
 * browser, and losing that argument means the page leaves instead.
 */

export interface SwipeActions {
  onLeft?: () => void;
  onRight?: () => void;
}

/** How far the finger must travel before the row commits to a direction. */
const DIRECTION_LOCK_PX = 8;
/** How far it must be at release for the action to fire. */
const COMMIT_PX = 72;
/** Past this the row stops following, so it never leaves its own list. */
const MAX_PX = 96;

export function useSwipe({ onLeft, onRight }: SwipeActions) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  // 'unknown' until the finger has moved enough to judge, then it is fixed.
  const axis = useRef<'unknown' | 'x' | 'y'>('unknown');

  const enabled = Boolean(onLeft || onRight);

  function reset() {
    start.current = null;
    axis.current = 'unknown';
    setDx(0);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (!enabled || e.pointerType === 'mouse') return;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = 'unknown';
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const from = start.current;
    if (!from) return;

    const moveX = e.clientX - from.x;
    const moveY = e.clientY - from.y;

    if (axis.current === 'unknown') {
      if (Math.abs(moveX) < DIRECTION_LOCK_PX && Math.abs(moveY) < DIRECTION_LOCK_PX) return;
      // Vertical wins ties. A list is scrolled far more often than it is
      // swiped, and stealing a scroll is the more annoying mistake.
      axis.current = Math.abs(moveX) > Math.abs(moveY) ? 'x' : 'y';
    }

    if (axis.current !== 'x') return;

    // Only offer directions that have somewhere to go, so a row with one
    // action does not appear to support two.
    const allowed = moveX < 0 ? Boolean(onLeft) : Boolean(onRight);
    if (!allowed) return;

    const clamped = Math.max(-MAX_PX, Math.min(MAX_PX, moveX));
    setDx(clamped);
  }

  function onPointerUp() {
    const travelled = dx;
    reset();

    if (Math.abs(travelled) < COMMIT_PX) return;
    if (travelled < 0) onLeft?.();
    else onRight?.();
  }

  return {
    /** Spread onto the row. */
    handlers: enabled
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp,
          // A pointer can be cancelled by the browser taking over the gesture —
          // a scroll starting, a back-navigation. Treated as a cancel, never
          // as a release, or the row would fire an action the user aborted.
          onPointerCancel: reset,
          onPointerLeave: reset,
        }
      : {},
    /** Current horizontal offset, for the transform. */
    dx,
    /** True once the row would act if released, so the affordance can light up. */
    armed: Math.abs(dx) >= COMMIT_PX,
  };
}

import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * useMagnetic — a control that leans toward the pointer and springs back.
 *
 * Returns a ref plus the two handlers to spread onto the element, alongside
 * the `fx-magnet` utility which owns the curves.
 *
 *   const magnet = useMagnetic();
 *   <Button className="fx-magnet" {...magnet}>Capture</Button>
 *
 * THE CAP IS THE DESIGN
 *
 * Offset is clamped to 6px, well inside the control's own padding. An
 * uncapped magnetic button chases the cursor out of its own hit area, so the
 * more you reach for it the harder it is to hit — the effect actively fights
 * the control. Six pixels is enough to be felt and not enough to move the
 * target.
 *
 * WHY THE TRANSFORM IS WRITTEN TO THE NODE
 *
 * Not React state. This fires on every pointermove; routing that through a
 * re-render would put a full reconciliation between the cursor moving and the
 * button following, which is exactly the lag the effect exists to avoid. It
 * would also re-render whatever screen the button sits on sixty times a
 * second while the pointer rests on it.
 *
 * Reduced motion is honoured by doing nothing at all, so the control is simply
 * a control.
 */

const MAX_OFFSET = 6;

export function useMagnetic(max: number = MAX_OFFSET) {
  const ref = useRef<HTMLElement | null>(null);

  const reduced = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const release = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('is-tracking');
    el.style.transform = '';
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const el = ref.current;
      if (!el || reduced()) return;

      // A coarse pointer is a finger, and a finger is already on the control
      // when this fires — there is nothing to lean toward, and the transform
      // would just make the press look like a mis-tap.
      if (e.pointerType !== 'mouse') return;

      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);

      const clamp = (n: number) => Math.max(-1, Math.min(1, n));

      el.classList.add('is-tracking');
      el.style.transform = `translate(${(clamp(dx) * max).toFixed(2)}px, ${(
        clamp(dy) * max
      ).toFixed(2)}px)`;
    },
    [max],
  );

  // A control can be unmounted mid-lean — a sheet closing under the cursor,
  // a route change. Without this the inline transform would be restored onto
  // whatever React reuses the node for.
  useEffect(() => release, [release]);

  return {
    ref: ref as React.RefObject<never>,
    onPointerMove,
    onPointerLeave: release,
    // Pointer capture can end without a leave event — dragging off the edge
    // of the window, for one. Blur is the reliable second net.
    onBlur: release,
  };
}

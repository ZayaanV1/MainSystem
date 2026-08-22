import { useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * useMagnetic — a control that leans toward the pointer and springs back.
 *
 * Returns the handlers to spread onto the element, alongside the `fx-magnet`
 * utility which owns the curves.
 *
 *   const magnet = useMagnetic();
 *   <Button variant="primary" className="fx-magnet" {...magnet}>What now?</Button>
 *
 * WHY THERE IS NO REF
 *
 * The obvious shape for this is a ref plus handlers, and it is a trap here.
 * `Button` is a plain function component that spreads its rest props onto the
 * underlying element; whether a `ref` survives that trip depends on the React
 * version and on the component not destructuring it away. If it does not
 * survive, `ref.current` stays null, the hook does nothing, and there is no
 * error anywhere — the effect is simply absent, which is the hardest kind of
 * bug to notice in an animation.
 *
 * The element is already in hand: it is `e.currentTarget`, which is by
 * definition the node the handler is attached to. No ref, no forwarding
 * contract, nothing to keep in sync, and it works on any component that passes
 * its event handlers through. It also removes the unmount cleanup, because
 * there is no retained reference to a node that might outlive its component.
 *
 * THE CAP IS THE DESIGN
 *
 * Offset is clamped to 6px, well inside the control's own padding. An
 * uncapped magnetic button chases the cursor out of its own hit area, so the
 * more you reach for it the harder it is to hit — the effect actively fights
 * the control. Six pixels is enough to be felt and not enough to move the
 * target.
 *
 * The transform is written straight to the node rather than held in state.
 * This fires on every pointermove; routing that through a re-render would put
 * a full reconciliation between the cursor moving and the button following,
 * which is exactly the lag the effect exists to remove, and would re-render
 * the whole screen sixty times a second while the pointer merely rests on it.
 */

const MAX_OFFSET = 6;

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useMagnetic(max: number = MAX_OFFSET) {
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (prefersReducedMotion()) return;

      // A coarse pointer is a finger, and a finger is already on the control
      // when this fires — there is nothing to lean toward, and the transform
      // would just make the press look like a mis-tap.
      if (e.pointerType !== 'mouse') return;

      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;

      const clamp = (n: number) => Math.max(-1, Math.min(1, n));
      const dx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2));
      const dy = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2));

      el.classList.add('is-tracking');
      el.style.transform = `translate(${(dx * max).toFixed(2)}px, ${(dy * max).toFixed(2)}px)`;
    },
    [max],
  );

  const release = useCallback((e: ReactPointerEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.classList.remove('is-tracking');
    el.style.transform = '';
  }, []);

  return {
    onPointerMove,
    onPointerLeave: release,
    // Pointer capture can end without a leave event — dragging off the edge of
    // the window, a sheet closing under the cursor. Blur is the second net.
    onBlur: release,
  };
}

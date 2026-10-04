import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { haptic, popArm } from '../lib/motion';

/**
 * A row you swipe, built on the browser's own scrolling (Phase B).
 *
 * It replaced a pointer-event swipe that moved the row from JavaScript on
 * every pointermove: a busy screen made it lag behind the finger, and it had
 * no momentum and no rubber band. Here the row is a horizontal scroll
 * container with snap points at Done, the row itself and Tomorrow, so the
 * browser tracks the finger, carries the throw and settles it, at the
 * display's own rate even while the app is working.
 *
 * Swipe right reveals Done, left reveals Tomorrow; letting go past the
 * middle of a panel commits it. Crossing that point pops the panel's icon and
 * ticks the phone, so you know before you let go. Only a hand commits:
 * scrolling the row from code never does.
 */

/** How wide each action panel is, and so how far a swipe must reach. */
const PANEL = 92;

export function SwipeRow({
  onRight,
  onLeft,
  rightLabel = 'Done',
  children,
}: {
  /** Swiping right: finishing. */
  onRight?: () => void;
  /** Swiping left: tomorrow. */
  onLeft?: () => void;
  rightLabel?: string;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const rightIcon = useRef<HTMLSpanElement>(null);
  const leftIcon = useRef<HTMLSpanElement>(null);
  const handlers = useRef({ onRight, onLeft });
  handlers.current = { onRight, onLeft };
  // The label is held for the length of a gesture: finishing flips the row to
  // done, and the panel must not change its word to "Reopen" while the row it
  // just finished is still on its way out.
  const busy = useRef(false);
  const label = useRef(rightLabel);
  if (!busy.current) label.current = rightLabel;
  const home = onRight ? PANEL : 0;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = home;

    let touched = false;
    let armed = 0;
    let timer = 0;
    let settledOnce = false;
    const touch = () => {
      touched = true;
      busy.current = true;
    };

    const reveal = () => {
      const fromHome = el.scrollLeft - home;
      const r = handlers.current.onRight ? Math.max(0, -fromHome) / PANEL : 0;
      const l = handlers.current.onLeft ? Math.max(0, fromHome) / PANEL : 0;
      if (rightIcon.current) {
        rightIcon.current.style.opacity = String(Math.min(1, r * 1.4));
        rightIcon.current.style.transform = `scale(${0.6 + Math.min(1, r) * 0.4})`;
      }
      if (leftIcon.current) {
        leftIcon.current.style.opacity = String(Math.min(1, l * 1.4));
        leftIcon.current.style.transform = `scale(${0.6 + Math.min(1, l) * 0.4})`;
      }
      if (!touched) return;
      const next = r > 0.55 ? 1 : l > 0.55 ? -1 : 0;
      if (next === armed) return;
      armed = next;
      if (next === 0) return;
      haptic();
      popArm(next > 0 ? rightIcon.current : leftIcon.current);
    };

    const settle = () => {
      if (!touched || !el.isConnected) return;
      const max = el.scrollWidth - el.clientWidth;
      if (handlers.current.onRight && el.scrollLeft <= 2) {
        touched = false;
        handlers.current.onRight();
        settledOnce = true;
      } else if (handlers.current.onLeft && el.scrollLeft >= max - 2) {
        touched = false;
        handlers.current.onLeft();
        settledOnce = true;
      } else {
        touched = false;
        busy.current = false;
        return;
      }
      // A row that stays where it is (a finished item in Week, say) eases
      // home once its action has been taken; a row that leaves is gone first.
      window.setTimeout(() => {
        if (el.isConnected && settledOnce) el.scrollTo({ left: home, behavior: 'smooth' });
        settledOnce = false;
        busy.current = false;
      }, 650);
    };

    const onScroll = () => {
      reveal();
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 140);
    };
    const onEnd = () => {
      window.clearTimeout(timer);
      settle();
    };

    el.addEventListener('pointerdown', touch, { passive: true });
    el.addEventListener('touchstart', touch, { passive: true });
    el.addEventListener('wheel', touch, { passive: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', onEnd);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('pointerdown', touch);
      el.removeEventListener('touchstart', touch);
      el.removeEventListener('wheel', touch);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onEnd);
    };
  }, [home]);

  if (!onRight && !onLeft) return <>{children}</>;

  return (
    <div ref={scroller} className="swipe-row">
      <div className="swipe-track" style={{ '--panel': `${PANEL}px` } as CSSProperties}>
        {onRight && (
          <div aria-hidden className="swipe-panel swipe-done">
            <span ref={rightIcon} className="swipe-icon">
              <svg width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 6.2 4.8 8.5 9.5 3.8" />
              </svg>
            </span>
            <span>{label.current}</span>
          </div>
        )}
        <div className="swipe-content">{children}</div>
        {onLeft && (
          <div aria-hidden className="swipe-panel swipe-defer">
            <span ref={leftIcon} className="swipe-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12h12M12 6l6 6-6 6M20 5v14" />
              </svg>
            </span>
            <span>Tomorrow</span>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, type RefObject } from 'react';
import { haptic } from './motion';

/**
 * Dragging a piece of work onto another day.
 *
 * Touch starts with a long press (450 ms, a haptic tick when it lifts), so a
 * scroll or a swipe that happens to start on a row is never a drag: moving
 * before the press completes hands the gesture back to the page. A mouse
 * starts after a few pixels of movement with the button held.
 *
 * Rows mark themselves with data-drag-work="<id>"; days are anything with
 * data-day or data-drop-day inside the container. The row lifts into a ghost
 * that follows the pointer, the day under it is marked, and the page scrolls
 * when the pointer nears an edge. Letting go on a different day calls onDrop;
 * anywhere else, nothing happens. The tap that started a drag never also
 * opens the row.
 */
export function useDragToDay(
  container: RefObject<HTMLElement | null>,
  onDrop: (id: string, day: string) => void,
): void {
  const drop = useRef(onDrop);
  drop.current = onDrop;

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    type Pending = { id: string; el: HTMLElement; x: number; y: number; touch: boolean; timer: number };
    type Drag = { id: string; el: HTMLElement; from: string | null; ghost: HTMLElement; dx: number; dy: number; over: HTMLElement | null; x: number; y: number; raf: number };
    let pending: Pending | null = null;
    let drag: Drag | null = null;
    let swallowClick = false;

    const dayOf = (el: Element | null) => el?.closest<HTMLElement>('[data-day], [data-drop-day]') ?? null;
    const dayKey = (el: HTMLElement | null) => el?.dataset.day ?? el?.dataset.dropDay ?? null;

    function start() {
      if (!pending) return;
      const { id, el, x, y } = pending;
      const box = el.getBoundingClientRect();
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-drag-work');
      ghost.classList.add('drag-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      Object.assign(ghost.style, { width: `${box.width}px`, left: `${box.left}px`, top: `${box.top}px` });
      document.body.append(ghost);
      el.dataset.dragging = '';
      document.documentElement.dataset.draggingWork = '';
      haptic();
      drag = { id, el, from: dayKey(dayOf(el)), ghost, dx: x - box.left, dy: y - box.top, over: null, x, y, raf: 0 };
      pending = null;
      scrollLoop();
    }

    // Near the top or bottom of the window, the page scrolls toward it, so a
    // day off screen can still be reached.
    function scrollLoop() {
      if (!drag) return;
      const edge = 64;
      const h = window.innerHeight;
      const speed = drag.y < edge ? -(edge - drag.y) / 4 : drag.y > h - edge ? (drag.y - (h - edge)) / 4 : 0;
      if (speed) {
        window.scrollBy(0, speed);
        mark();
      }
      drag.raf = requestAnimationFrame(scrollLoop);
    }

    function mark() {
      if (!drag) return;
      const under = dayOf(document.elementFromPoint(drag.x, drag.y));
      const over = under && root!.contains(under) ? under : null;
      if (over !== drag.over) {
        drag.over?.removeAttribute('data-drop-over');
        if (over && dayKey(over) !== drag.from) over.setAttribute('data-drop-over', '');
        drag.over = over;
      }
    }

    function end(commit: boolean) {
      if (pending) {
        window.clearTimeout(pending.timer);
        pending = null;
      }
      if (!drag) return;
      const { id, el, ghost, over, from, raf } = drag;
      cancelAnimationFrame(raf);
      over?.removeAttribute('data-drop-over');
      delete el.dataset.dragging;
      delete document.documentElement.dataset.draggingWork;
      ghost.remove();
      drag = null;
      swallowClick = true;
      window.setTimeout(() => (swallowClick = false), 350);
      const to = dayKey(over);
      if (commit && to && to !== from) drop.current(id, to);
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || drag) return;
      const target = e.target as Element;
      const el = target.closest<HTMLElement>('[data-drag-work]');
      if (!el || !root.contains(el) || target.closest('input, textarea, select, [data-no-drag]')) return;
      const touch = e.pointerType !== 'mouse';
      pending = {
        id: el.dataset.dragWork as string,
        el,
        x: e.clientX,
        y: e.clientY,
        touch,
        timer: touch ? window.setTimeout(start, 450) : 0,
      };
    };

    const onMove = (e: PointerEvent) => {
      if (pending && !drag) {
        const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
        if (!pending.touch) {
          if (dist > 6) start();
          else return;
        } else {
          // Moving before the press completes is a scroll or a swipe.
          if (dist > 8) end(false);
          return;
        }
      }
      if (!drag) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.ghost.style.transform = `translate(${e.clientX - drag.dx - parseFloat(drag.ghost.style.left)}px, ${e.clientY - drag.dy - parseFloat(drag.ghost.style.top)}px) rotate(-1.5deg) scale(1.02)`;
      mark();
    };

    // Once a drag has begun, a finger moving must move the row, not the page.
    const onTouchMove = (e: TouchEvent) => {
      if (drag) e.preventDefault();
    };
    // A long press would otherwise open the system menu on the row.
    const onContext = (e: Event) => {
      if (pending || drag) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      e.preventDefault();
      e.stopPropagation();
      swallowClick = false;
    };
    const onUp = () => end(true);
    const onCancel = () => end(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag) end(false);
    };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('contextmenu', onContext);
    root.addEventListener('click', onClick, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      end(false);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('contextmenu', onContext);
      root.removeEventListener('click', onClick, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [container]);
}

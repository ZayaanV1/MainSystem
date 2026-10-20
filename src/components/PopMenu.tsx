import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { popClose, popOpen } from '../lib/motion';

export function Check({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="pop-check">
      {on && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </span>
  );
}

/**
 * A ⋯ menu: a pull-down under the button it was opened from, as iOS draws
 * one. Schedule's and Today's.
 *
 * Closes on a choice, on a tap anywhere else, and on Escape, handing focus
 * back to the button. The arrow keys move through it, as its role promises.
 * `choose` closes first and then acts, so a style change cross-fades the
 * week without the menu caught in the snapshot.
 */
export function PopMenu({
  label,
  anchor,
  onClose,
  children,
}: {
  /** The menu's accessible name, "Today options". */
  label: string;
  anchor: HTMLElement;
  onClose: () => void;
  children: (choose: (act: () => void) => void) => ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [place] = useState(() => {
    const r = anchor.getBoundingClientRect();
    return { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) };
  });

  const closing = useRef(false);
  const close = async (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    await popClose(menu.current);
    onClose();
    anchor.focus();
    then?.();
  };

  useLayoutEffect(() => {
    popOpen(menu.current, '100% 0%');
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The menu's alone: App's Escape would otherwise also leave for Today.
      e.preventDefault();
      void close();
    };
    // A scroll moves the button away from the menu hanging under it.
    const onScroll = () => void close();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
    // Once, while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <>
      <div aria-hidden className="pop-catcher" onClick={() => void close()} />
      <div
        ref={menu}
        role="menu"
        aria-label={label}
        className="pop-menu"
        style={{ top: place.top, right: place.right }}
        onKeyDown={onKeyDown}
      >
        {children((act) => void close(act))}
      </div>
    </>
  );
}

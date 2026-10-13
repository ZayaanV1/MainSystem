import { useEffect, useState, type ReactNode, type RefObject } from 'react';

/**
 * The large title, folded into a bar once it scrolls away (the iPhone review,
 * 12 Oct 2026).
 *
 * Installed to the Home Screen the status bar is transparent, so a scrolled
 * page ran its text straight under the clock with nothing behind it. iOS
 * answers this with a large title that folds into a compact bar with a
 * backdrop, and so does this: once the title has gone under the top edge,
 * a bar with the screen's name and its one action slides in over the status
 * bar's area.
 *
 * Phones and tablets only: the desk layout has the rail and no status bar.
 * While hidden the bar is inert, so its copy of the action is never a second
 * thing to tab to.
 */
export function CompactBar({
  title,
  watch,
  children,
}: {
  title: string;
  /** The large title. The bar shows once this has scrolled out of sight. */
  watch: RefObject<HTMLElement | null>;
  /** The screen's action, on the right: What now, the Week menu. */
  children?: ReactNode;
}) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = watch.current;
      // The bar is 44 px under the inset; the title is gone once its bottom
      // edge passes that line.
      if (el) setOn(el.getBoundingClientRect().bottom < 52);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [watch]);

  return (
    <div className="compact-bar lg:hidden" data-on={on || undefined} inert={!on || undefined}>
      <span aria-hidden className="compact-bar-title">
        {title}
      </span>
      {children && <div className="compact-bar-end">{children}</div>}
    </div>
  );
}

/**
 * The strip behind the status bar, on every screen.
 *
 * The screens with a large title get the compact bar above; this is for the
 * rest, so that a scrolled page never puts its text under the clock. Shown
 * only once the page has moved: at the top, the page's own ground is what
 * belongs there, and a lighter band over it would be a bar with nothing in it.
 */
export function StatusVeil() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      setOn(window.scrollY > 4);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  return <div aria-hidden className="status-veil lg:hidden" data-on={on || undefined} />;
}

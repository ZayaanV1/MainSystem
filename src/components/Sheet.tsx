import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { flyText, recedePage, restorePage } from '../lib/motion';

/**
 * Sheet — a bottom sheet.
 *
 * Enters from the bottom in 250ms. Bottom-anchored because primary actions
 * belong in the lower third of the screen where a thumb reaches them, and
 * because a sheet that grows from where you tapped is less startling than one
 * that appears over the whole screen.
 *
 * Closes on Escape, on backdrop tap, and on the explicit close control. Focus
 * is moved into the sheet on open and restored on close, so keyboard and
 * screen-reader users are not left behind on the page underneath.
 *
 * Phase B, on a phone: the page behind recedes as the sheet rises, the
 * contents arrive a beat after the surface, and a sheet opened from
 * something on the page can carry its title with it (`flightFrom`). Rendered
 * into document.body, so the receding page cannot take the sheet with it.
 */

/*
 * Most sheets are shown by their parent with `{thing && <Editor … />}`, so the
 * moment `thing` clears the whole sheet is removed and its exit never runs.
 * SheetPresence keeps the last thing it rendered on screen, tells the Sheet
 * inside that it is closing, and lets go once the Sheet has animated out.
 * Wrap any conditionally rendered sheet in it (rule 12).
 */
const Closing = createContext<{ closing: boolean; done: () => void } | null>(null);

export function SheetPresence({ children }: { children: ReactNode }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const last = useRef<ReactNode>(null);
  const shown = Boolean(children);
  if (shown) last.current = children;
  const closing = !shown && last.current !== null;
  const done = useRef(() => {
    last.current = null;
    rerender();
  }).current;
  // Stable while `closing` holds: a new object on every render re-ran the
  // Sheet's closing effect whenever the parent re-rendered mid-exit (a save
  // reloads Today), restarting the exit and launching the title flight again.
  const value = useMemo(() => ({ closing, done }), [closing, done]);
  if (!shown && !closing) return null;
  return <Closing.Provider value={value}>{shown ? children : last.current}</Closing.Provider>;
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * On a wide screen, dock to the right instead of covering the page.
   *
   * A bottom sheet is right on a phone, where there is one column and the
   * thing you opened IS the screen. On a desktop it covers a list you were
   * just reading in order to show you one row of it — so you lose the context
   * you opened it from, and closing is the only way to get it back.
   *
   * Docked, the list stays visible and the detail sits beside it. That is what
   * makes opening a piece of work cheap enough to do repeatedly, which is most
   * of what a planner is for.
   *
   * Still modal, still focus-trapped, still Escape-to-close. Only the geometry
   * changes — a docked panel that stopped being modal would be a third
   * behaviour to learn at a breakpoint nobody chose to cross.
   */
  dock?: boolean;
  /**
   * A selector for the element the sheet was opened from, whose words fly
   * into the sheet's title as it rises and back when it closes, such as the
   * title of the slip that was tapped.
   */
  flightFrom?: string;
}

export function Sheet({ open: openProp, onClose, title, children, dock = false, flightFrom }: SheetProps) {
  const presence = useContext(Closing);
  const open = openProp && !presence?.closing;
  const panel = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  /*
   * `onClose` is read through a ref rather than depended on.
   *
   * Every caller passes it as an inline arrow, so its identity changes on each
   * render of the parent. Listing it as a dependency meant the effect below
   * tore down and re-ran whenever the parent re-rendered — and since it calls
   * `panel.focus()`, that pulled focus out of whatever input was being typed
   * into. On a phone, losing focus dismisses the keyboard: type a character,
   * the keyboard closes.
   *
   * It only bit where the input's state lived in the sheet's PARENT, which is
   * why it was intermittent rather than universal, and why it was invisible on
   * a desktop where losing focus costs nothing you can see.
   */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);

    // The page behind must not scroll while a sheet is over it, or dismissing
    // the sheet leaves you somewhere you did not navigate to.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restoreFocusTo.current?.focus();
    };
    // Deliberately only `open`. See the ref above.
  }, [open]);

  /*
   * Closing is animated too (rule 12). It used to return null the moment
   * `open` went false, so every sheet in the app arrived with a rise and left
   * with a cut. The sheet now stays mounted, untouchable, while it sinks and
   * the scrim lifts, and only then unmounts.
   */
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  const scrim = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // A docked panel on a wide screen sits beside the page; nothing recedes
  // and nothing flies, or the page you kept open would shrink away from you.
  const besidePage = () => Boolean(dock) && matchMedia('(min-width: 64rem)').matches;

  // Arriving: the page recedes and the title flies in, on the sheet's own curve.
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    if (besidePage()) return;
    recedePage();
    const src = flightFrom ? document.querySelector<HTMLElement>(flightFrom) : null;
    if (src && heading.current) flyText(src, heading.current, panel.current, 'in');
    return () => restorePage();
    // Only on opening. The flight reads the page as it was when tapped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (open) {
      // Reopened while closing: drop the exit, keep the CSS entrance.
      for (const el of [panel.current, scrim.current]) {
        el?.getAnimations().forEach((a) => {
          if (!(a instanceof CSSAnimation)) a.cancel();
        });
      }
      return;
    }
    if (!present) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const docked = besidePage();
    // Leaving: the title flies back to where it came from, if that is still
    // on the page (a finished slip has left, so it stays in the sheet).
    const home = flightFrom ? document.querySelector<HTMLElement>(flightFrom) : null;
    if (home && heading.current && panel.current && !docked) flyText(heading.current, home, panel.current, 'out');
    const leave: Keyframe[] = still
      ? [{ opacity: 1 }, { opacity: 0 }]
      : docked
        ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(4%)' }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0.6, transform: 'translateY(100%)' }];
    const timing: KeyframeAnimationOptions = {
      duration: still ? 200 : 240,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    };
    const anims = [
      panel.current?.animate?.(leave, timing),
      scrim.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { ...timing, easing: 'ease-out' }),
    ].filter((a): a is Animation => Boolean(a));
    if (anims.length === 0) {
      setPresent(false);
      presence?.done();
      return;
    }
    let live = true;
    const gone = () => {
      if (!live) return;
      setPresent(false);
      presence?.done();
    };
    void Promise.all(anims.map((a) => a.finished)).then(gone, gone);
    return () => {
      live = false;
    };
  }, [open, present, dock, presence]);

  if (!present) return null;

  return createPortal(
    <div
      inert={!open || undefined}
      className={[
        'fixed inset-0 z-50 flex justify-center',
        // Bottom on a phone; right-hand edge, full height, once docked.
        dock ? 'items-end lg:items-stretch lg:justify-end' : 'items-end',
      ].join(' ')}
    >
      {/* The page behind dims and softens, so the sheet reads as a surface
          lifted off it rather than a box painted on top of it. */}
      <div
        ref={scrim}
        className="sheet-scrim absolute inset-0 animate-[scrim-in_250ms_cubic-bezier(0.2,0,0,1)]"
        onClick={onClose}
        aria-hidden
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={[
          'sheet-panel sheet-stage relative w-full max-w-160 px-6 pb-8 pt-6',
          // Docked: a column against the right edge rather than a slab across
          // the bottom. The border replaces the rounded top corners, which
          // read as "this rose from below" and would be a lie here.
          dock
            ? 'lg:h-full lg:max-w-[34rem] lg:rounded-none'
            : '',
          // A sheet taller than the screen must scroll, not overflow. The
          // history grid and a long editor both exceed a phone easily.
          'max-h-[90dvh] overflow-y-auto overscroll-contain',
          'rounded-t-sheet',
          /*
            Two entrances, because there are two geometries.
            A bottom sheet rises; a docked panel arrives from the edge it is
            anchored to. Running one animation for both meant the desktop
            panel slid up the full height of the window and stopped against
            the right-hand edge — travelling from somewhere it does not live,
            past everything it was opened from.
          */
          dock
            ? 'motion-safe:animate-[sheet-in_420ms_cubic-bezier(0.32,0.72,0,1)] motion-safe:lg:animate-[panel-in_260ms_cubic-bezier(0.2,0,0,1)]'
            : 'motion-safe:animate-[sheet-in_420ms_cubic-bezier(0.32,0.72,0,1)]',
          // The sheet sits above the home indicator on an installed PWA.
          // Under Reduce Motion the sheet fades in instead of rising: still a
          // visible arrival (rule 12), with no travel.
          'motion-reduce:animate-[sheet-fade_200ms_ease-out]',
          'pb-[calc(var(--sp-8)+env(safe-area-inset-bottom))]',
        ].join(' ')}
      >
        {/* The grab handle a bottom sheet has on every phone. Decorative: the
            sheet closes on the scrim, Escape and the close control. */}
        <div aria-hidden className={`sheet-handle ${dock ? 'lg:hidden' : ''}`} />

        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 ref={heading} className="section-title sheet-title">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-quiet btn-icon">
            <svg
              aria-hidden
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {children}
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, type ReactNode } from 'react';

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
 */

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
}

export function Sheet({ open, onClose, title, children, dock = false }: SheetProps) {
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

  if (!open) return null;

  return (
    <div
      className={[
        'fixed inset-0 z-50 flex justify-center',
        // Bottom on a phone; right-hand edge, full height, once docked.
        dock ? 'items-end lg:items-stretch lg:justify-end' : 'items-end',
      ].join(' ')}
    >
      {/* The page behind dims and softens, so the sheet reads as a surface
          lifted off it rather than a box painted on top of it. */}
      <div
        className="sheet-scrim absolute inset-0 motion-safe:animate-[scrim-in_250ms_cubic-bezier(0.2,0,0,1)]"
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
          'sheet-panel relative w-full max-w-160 px-6 pb-8 pt-6',
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
            ? 'motion-safe:animate-[sheet-in_250ms_cubic-bezier(0.2,0,0,1)] motion-safe:lg:animate-[panel-in_220ms_cubic-bezier(0.2,0,0,1)]'
            : 'motion-safe:animate-[sheet-in_250ms_cubic-bezier(0.2,0,0,1)]',
          // The sheet sits above the home indicator on an installed PWA.
          'pb-[calc(var(--sp-8)+env(safe-area-inset-bottom))]',
        ].join(' ')}
      >
        {/* The grab handle a bottom sheet has on every phone. Decorative: the
            sheet closes on the scrim, Escape and the close control. */}
        <div aria-hidden className={`sheet-handle ${dock ? 'lg:hidden' : ''}`} />

        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="section-title sheet-title">{title}</h2>
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
    </div>
  );
}

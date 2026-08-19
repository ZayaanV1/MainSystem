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
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-ink-900/70"
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
          'relative w-full max-w-160 bg-ink-700 px-6 pb-8 pt-6',
          // A sheet taller than the screen must scroll, not overflow. The
          // history grid and a long editor both exceed a phone easily.
          'max-h-[90dvh] overflow-y-auto overscroll-contain',
          'rounded-t-sheet',
          'motion-safe:animate-[sheet-in_250ms_cubic-bezier(0.2,0,0,1)]',
          // The sheet sits above the home indicator on an installed PWA.
          'pb-[calc(var(--sp-8)+env(safe-area-inset-bottom))]',
        ].join(' ')}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="type-h2 text-text-hi">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="action-chip type-label"
          >
            Close
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

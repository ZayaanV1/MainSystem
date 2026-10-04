import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom';
import { popClose } from '../lib/motion';

/**
 * The bar that offers to take back the tap you just made.
 *
 * Finishing work is one tap, so taking it back has to be one tap too; a
 * finished slip leaves the list, and without this the only way back was to
 * find it again. It rises above the tab bar, holds for five seconds and
 * leaves by itself. Not a toast in the sense the copy rules dislike: it
 * carries the one action that matters right now, and asks nothing.
 *
 * Arriving and leaving are both animated (rule 12): it keeps rendering the
 * last message while it sinks away.
 */
export function UndoBar({
  message,
  onUndo,
  onDismiss,
}: {
  /** What was done, or null when there is nothing to offer. */
  message: string | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const last = useRef<string | null>(message);
  const bar = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  if (message) {
    last.current = message;
    leaving.current = false;
  }

  // Arrives on the glide; a new message while shown just swaps its words.
  const shownBefore = useRef(false);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el || !message) return;
    // A new message caught the bar on its way out: drop the exit (which holds
    // it at opacity 0 while it stays tappable) and bring it back in properly.
    const wasLeaving = el.getAnimations().length > 0 && Number(getComputedStyle(el).opacity) < 1;
    el.getAnimations().forEach((a) => a.cancel());
    if (wasLeaving) shownBefore.current = false;
    if (!shownBefore.current) {
      shownBefore.current = true;
      el.animate?.(
        [
          { opacity: 0, transform: 'translateY(16px) scale(0.98)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 420, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      );
    } else {
      el.querySelector('p')?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    }
  }, [message]);

  // Leaves when the message clears.
  useLayoutEffect(() => {
    if (message || !last.current || leaving.current) return;
    leaving.current = true;
    void popClose(bar.current).then(() => {
      if (!leaving.current) return;
      last.current = null;
      shownBefore.current = false;
      rerender();
    });
  }, [message]);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);

  if (!last.current) return null;
  // Into the body: the page column recedes behind an open sheet with a
  // transform, and a fixed bar inside it would be fixed to the column.
  return createPortal(
    <div
      ref={bar}
      role="status"
      inert={!message || undefined}
      className="undo-bar fixed inset-x-4 z-40 mx-auto flex max-w-[26rem] items-center gap-3 rounded-pill py-2 pr-2 pl-5"
    >
      <p className="min-w-0 flex-1 truncate type-label text-text-hi">{last.current}</p>
      <button type="button" onClick={onUndo} className="btn btn-quiet min-h-9 px-4 type-label">
        Undo
      </button>
    </div>,
    document.body,
  );
}

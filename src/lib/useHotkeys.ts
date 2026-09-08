import { useEffect } from 'react';

/**
 * Keyboard shortcuts, for the half of the time this is used on a laptop.
 *
 * Search is currently a nav item you click. On a desktop the whole point of
 * search is that it is faster than navigating, and making you navigate to it
 * removes most of that.
 *
 * WHAT THIS WILL NOT DO
 *
 * It never fires while you are typing. A shortcut that hijacks a keystroke
 * mid-sentence is worse than no shortcut, and this app is full of text fields
 * that people type real sentences into — the capture box exists specifically
 * to be typed into fast and unthinkingly. Anything inside an input, textarea,
 * select or contenteditable is left completely alone, including the bare "/"
 * form, which is exactly the character someone typing a date would use.
 *
 * It also stays out of the way of the browser. Only combinations the browser
 * does not already own are claimed: cmd/ctrl+K is free, cmd+F is emphatically
 * not, and taking it would break find-in-page on a screen that is mostly a
 * long list.
 */

export interface Hotkeys {
  /** cmd/ctrl+K, or a bare "/" outside a text field. */
  onSearch?: () => void;
  /** Escape, for closing whatever is open. */
  onEscape?: () => void;
}

/** Is the keystroke going into something the user is writing in? */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export function useHotkeys({ onSearch, onEscape }: Hotkeys): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Escape is the one shortcut that SHOULD work while typing — it is how
      // you get out of a field, and blocking it would trap the cursor.
      if (e.key === 'Escape') {
        onEscape?.();
        return;
      }

      if (isTyping(e.target)) return;

      // metaKey on a Mac, ctrlKey elsewhere. Checking both rather than
      // sniffing the platform: a Mac with an external PC keyboard sends ctrl,
      // and platform detection would get that wrong for no benefit.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onSearch?.();
        return;
      }

      // The bare "/" convention. Guarded by every modifier being absent, so it
      // cannot swallow a browser or OS combination that happens to produce a
      // slash on a non-US layout.
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onSearch?.();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSearch, onEscape]);
}

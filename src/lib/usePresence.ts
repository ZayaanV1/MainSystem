import { useCallback, useLayoutEffect, useReducer, useRef } from 'react';
import { closeUp, exitRow, measureBelow, returnRow, settleIn, type ExitKind } from './motion';

/**
 * Lists whose items leave on screen instead of vanishing. Rule 12.
 *
 * The optimistic layer takes a finished task out of the open list in the same
 * render that marks it done, so React unmounted the row and it was simply
 * gone: no tick landing, no exit, the list below jumping up into the gap.
 * This keeps an item that has left the data rendered, marked `leaving`, at
 * the place it left from, until its exit animation has finished. Then it is
 * dropped and everything below closes up as a cascade.
 *
 * The data stays honest throughout. The item is out of the list the moment
 * the write is made; only its picture lingers for a quarter of a second.
 *
 * Every rendered item needs `data-presence={key}` on the element that should
 * animate, inside the element given to `containerRef`. A leaving item should
 * be made `inert` so it cannot be tapped again on its way out.
 */

export interface Present<T> {
  item: T;
  key: string;
  leaving: boolean;
}

interface Ghost<T> {
  item: T;
  index: number;
}

/**
 * The rendered list: what is in the data, with each item still leaving put
 * back at the index it left from. Pure, so it is tested on its own.
 */
export function mergePresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  leaving: ReadonlyMap<string, Ghost<T>>,
): Present<T>[] {
  const out: Present<T>[] = items.map((item) => ({ item, key: keyOf(item), leaving: false }));
  const ghosts = [...leaving.entries()].sort((a, b) => a[1].index - b[1].index);
  for (const [key, { item, index }] of ghosts) {
    out.splice(Math.min(index, out.length), 0, { item, key, leaving: true });
  }
  return out;
}

/**
 * Which items left between two versions of a list, and where they were.
 * Pure, so it is tested on its own.
 */
export function departures<T>(
  before: readonly T[],
  after: readonly T[],
  keyOf: (item: T) => string,
): Map<string, Ghost<T>> {
  const now = new Set(after.map(keyOf));
  const out = new Map<string, Ghost<T>>();
  before.forEach((item, index) => {
    const key = keyOf(item);
    if (!now.has(key)) out.set(key, { item, index });
  });
  return out;
}

const HINT_MS = 4000;

export function usePresence<T>(
  items: readonly T[] | null,
  keyOf: (item: T) => string,
  { enter = false }: { enter?: boolean } = {},
) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const prev = useRef<readonly T[] | null>(items);
  const leaving = useRef(new Map<string, Ghost<T>>());
  // How the next departure of an item should look, and when that was said.
  // A hint is for the departure the tap causes; one that is not followed
  // within a few seconds, or whose item comes back, is forgotten, or a later
  // unrelated removal would leave as though it had been finished.
  const hints = useRef(new Map<string, { kind: ExitKind; at: number }>());
  const exiting = useRef(new Set<string>());
  const hintOf = useCallback((key: string): ExitKind | undefined => {
    const h = hints.current.get(key);
    // Long enough to cover a write's round trip; the exit itself reads the
    // hint as it starts, and leaving items keep theirs until they are gone.
    if (!h || (Date.now() - h.at > HINT_MS && !leaving.current.has(key))) return undefined;
    return h.kind;
  }, []);
  const arrived = useRef(new Set<string>());
  const flip = useRef<Map<HTMLElement, number> | null>(null);
  const container = useRef<HTMLElement | null>(null);

  // Diffed during render, so the leaving item is never unmounted for a frame:
  // the same key renders the same component instance straight through.
  if (prev.current !== items) {
    if (items === null || prev.current === null) {
      // Loading is not leaving: a reload that clears the data does not send
      // every row off the screen.
      leaving.current.clear();
      exiting.current.clear();
    } else {
      for (const [key, ghost] of departures(prev.current, items, keyOf)) {
        if (!leaving.current.has(key)) leaving.current.set(key, ghost);
      }
      const now = new Set(items.map(keyOf));
      for (const key of [...leaving.current.keys()]) {
        if (!now.has(key)) continue;
        leaving.current.delete(key);
        hints.current.delete(key);
      }
      if (enter) {
        const had = new Set(prev.current.map(keyOf));
        for (const key of now) if (!had.has(key)) arrived.current.add(key);
      }
    }
    prev.current = items;
  }

  const list = items === null ? [] : mergePresence(items, keyOf, leaving.current);

  useLayoutEffect(() => {
    const root = container.current;

    if (flip.current) {
      closeUp(flip.current);
      flip.current = null;
    }
    if (!root) return;
    const find = (key: string) =>
      root.querySelector<HTMLElement>(`[data-presence="${CSS.escape(key)}"]`);

    // Came back before it had gone (an undo, a second tap): bring it back.
    for (const key of [...exiting.current]) {
      if (leaving.current.has(key)) continue;
      exiting.current.delete(key);
      const el = find(key);
      if (el) returnRow(el);
    }

    for (const key of [...arrived.current]) {
      arrived.current.delete(key);
      const el = find(key);
      if (el) settleIn(el);
    }

    for (const key of leaving.current.keys()) {
      if (exiting.current.has(key)) continue;
      const el = find(key);
      if (!el) {
        leaving.current.delete(key);
        continue;
      }
      exiting.current.add(key);
      void exitRow(el, hintOf(key) ?? 'gone').then(() => {
        if (!exiting.current.has(key) || !leaving.current.has(key)) return;
        flip.current = measureBelow(el);
        leaving.current.delete(key);
        exiting.current.delete(key);
        hints.current.delete(key);
        rerender();
      });
    }
  });

  /** Say how the next departure of this item should look. */
  const hint = useCallback((key: string, kind: ExitKind) => {
    hints.current.set(key, { kind, at: Date.now() });
  }, []);
  const containerRef = useCallback((el: HTMLElement | null) => {
    container.current = el;
  }, []);

  return { list, containerRef, hint, hintOf };
}

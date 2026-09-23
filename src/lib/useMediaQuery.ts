import { useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept current as the window changes.
 *
 * For layout that CSS cannot express on its own — the hour grid is a
 * different component tree at desktop width (seven columns on one shared
 * axis) from the one it is on a phone (a grid per day), not the same tree
 * restyled.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== 'function') return () => {};
      const mq = matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false),
    () => false,
  );
}

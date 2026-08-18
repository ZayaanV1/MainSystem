/**
 * Service worker registration.
 *
 * Done with the platform API directly rather than through
 * `virtual:pwa-register`. That helper never registered anything on the
 * deployed site — no registration, no console error, nothing — because every
 * failure path inside it ends in `.catch(e => onRegisterError?.(e))`, and an
 * unsupplied handler means the error is dropped on the floor. Meanwhile
 * `navigator.serviceWorker.register('/sw.js')` called by hand on that same
 * deployment worked first time.
 *
 * So the helper bought a dependency, an extra chunk, and a silent failure
 * mode, in exchange for about fifteen lines. This project's rule is to prefer
 * boring and well understood, because every dependency is a thing that can
 * break at 2am — and this one broke the single feature it existed to enable.
 *
 * The registration result is kept so Settings can say what happened. A push
 * setup that cannot explain itself is how a week goes by without notifications.
 */

export type SwState =
  | { status: 'unsupported' }
  | { status: 'registering' }
  | { status: 'ready'; scope: string }
  | { status: 'failed'; error: string };

let state: SwState = { status: 'registering' };
const listeners = new Set<(s: SwState) => void>();

function set(next: SwState) {
  state = next;
  for (const fn of listeners) fn(state);
}

export function swState(): SwState {
  return state;
}

export function subscribeSw(fn: (s: SwState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    set({ status: 'unsupported' });
    return;
  }

  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      set({ status: 'ready', scope: registration.scope });

      // Updates apply silently. There is no "a new version is available"
      // prompt on purpose: it is a decision the user cannot make an informed
      // choice about, arriving while they were trying to do something else.
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
          // Only reload for a genuine replacement, never on first install —
          // reloading during the initial load would be an infinite loop.
          if (installing.state === 'activated' && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });

      // Pick up a new deploy on return to the app rather than only on a cold
      // start, which on an installed PWA can be days apart.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    })
    .catch((e: Error) => {
      // Loudly, unlike the helper this replaces.
      set({ status: 'failed', error: e.message });
      console.error('Service worker registration failed:', e);
    });
}

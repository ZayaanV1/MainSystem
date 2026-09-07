/**
 * Light and dark, as a choice rather than an inheritance.
 *
 * tokens.css has carried a complete, contrast-measured light palette in two
 * blocks since the redesign — and nothing in the shipped app ever set
 * `data-theme`. The only writer was the dev-only specimen page. So a user got
 * light mode if and only if their operating system asked for it, could never
 * override it in either direction, and half the palette work was unreachable.
 *
 * THREE STATES, NOT TWO
 *
 * "System" is a real state and it is the default. Storing only "light" or
 * "dark" would silently freeze whatever the OS happened to be saying the first
 * time someone opened Settings, and a phone that switches at sunset would
 * stop switching. `data-theme` is therefore ABSENT for system, which is
 * exactly what the CSS expects: the media query handles that case, and the
 * two attribute selectors override it in either direction.
 *
 * WHY THIS IS NOT IN THE DATABASE
 *
 * Theme is per-device, not per-account. The same person on a phone at night
 * and a laptop at noon wants different answers, and syncing it would make the
 * laptop change when the phone did. localStorage is the correct scope. It also
 * means the choice survives being logged out, and applies before any network
 * call has happened — which is what stops the flash.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'planner.theme';

export function readTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    // Private mode, or storage disabled. System is the honest fallback.
    return 'system';
  }
}

/** What the page is actually showing right now, with `system` resolved. */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;

  // Absent for system, so the media query in tokens.css is what decides.
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  /*
   * The status bar and the address bar read this, and it must be a literal
   * colour — a meta tag cannot hold a var(). So it is READ from the live
   * stylesheet rather than duplicated here.
   *
   * The first attempt hardcoded the two values and the colour-law test caught
   * it, correctly — it scans comments too, so even naming the old value here
   * fails, which is the guard working rather than being pedantic. Duplicating
   * the ground is exactly how this tag ended up stuck on the cool near-black
   * from two palettes ago while the app around it moved on. Reading --ink-900
   * means the system chrome cannot drift from the ground again.
   */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const ground = getComputedStyle(root).getPropertyValue('--ink-900').trim();
    if (ground) meta.setAttribute('content', ground);
  }
}

export function writeTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Not fatal: the theme still applies for this session.
  }
  applyTheme(choice);
}

/**
 * Keeps `system` actually following the system.
 *
 * Without this the OS could switch at sunset and the page would hold whatever
 * it resolved at load — which makes "System" a lie after the first hour.
 * Returns an unsubscribe.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-color-scheme: light)');
  const handler = () => {
    if (readTheme() === 'system') {
      applyTheme('system');
      onChange();
    }
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

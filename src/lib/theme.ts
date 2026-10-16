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

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;

  // Absent for system, so the media query in tokens.css is what decides.
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  syncChrome();
}

/**
 * The status bar and the address bar follow the ground of whatever theme and
 * mode are showing.
 */
function syncChrome(): void {
  const root = document.documentElement;

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

/* ============================================================================
   Themes: a whole look, chosen per account.

   Six complete themes, each a designed dark and light pair (tokens.css,
   THEMES). The theme follows the account so the phone and the laptop match;
   light or dark (above) stays per device. The account's choice is cached here
   so index.html can apply it before the first paint: a cached theme never
   flashes, and a new device shows the default for one load at most.
   ========================================================================= */

export type Skin = 'cloisonne' | 'letterpress' | 'instrument' | 'fjord' | 'contrast' | 'nothing';

export const SKINS: { id: Skin; name: string; line: string; reference: string }[] = [
  { id: 'cloisonne', name: 'Cloisonné', line: 'Burnt orange and phthalo, enamel lit from inside', reference: 'Cloisonné enamel' },
  { id: 'letterpress', name: 'Letterpress', line: 'Press-blue ink on laid paper, set in a serif', reference: 'A letterpress proof' },
  { id: 'instrument', name: 'Instrument', line: 'Amber phosphor on a black panel, square and exact', reference: 'A cockpit panel' },
  { id: 'fjord', name: 'Fjord', line: 'Fog, birch and fjord blue, soft and unhurried', reference: 'A Nordic morning' },
  { id: 'contrast', name: 'High contrast', line: 'Black, white and one bright colour, for any light', reference: 'Signage, and a face drawn for legibility' },
  { id: 'nothing', name: 'Dot matrix', line: 'Black, white and one red dot, with a clock on Today', reference: 'After Nothing OS' },
];

const SKIN_KEY = 'planner.skin';

export function isSkin(v: unknown): v is Skin {
  return SKINS.some((s) => s.id === v);
}

export function readSkin(): Skin {
  try {
    const raw = localStorage.getItem(SKIN_KEY);
    return isSkin(raw) ? raw : 'cloisonne';
  } catch {
    return 'cloisonne';
  }
}

/** Show a theme now. The default is the absence of the attribute, as for mode. */
export function applySkin(skin: Skin): void {
  const root = document.documentElement;
  if (skin === 'cloisonne') root.removeAttribute('data-skin');
  else root.setAttribute('data-skin', skin);
  syncChrome();
}

/** Remember a theme on this device, for the pre-paint script, and show it. */
export function cacheSkin(skin: Skin): void {
  try {
    if (skin === 'cloisonne') localStorage.removeItem(SKIN_KEY);
    else localStorage.setItem(SKIN_KEY, skin);
  } catch {
    // Not fatal: the account still holds it, and it applies after load.
  }
  applySkin(skin);
}

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
   Colour schemes: the palette and type, chosen per account.

   Seventeen schemes, each a designed dark and light pair (tokens.css). Since
   2 Nov 2026 a scheme is only colour and type; the material it is drawn in
   (glass, dot matrix or plain) is the theme, below, and any theme takes any
   scheme. Both follow the account so the phone and the laptop match; light
   or dark (above) stays per device. Both are cached here so index.html can
   apply them before the first paint.

   The default is Dusk under Glass: a new account starts on the glass theme.
   ========================================================================= */

export type Skin =
  | 'cloisonne'
  | 'letterpress'
  | 'instrument'
  | 'fjord'
  | 'contrast'
  | 'nothing'
  | 'arc'
  | 'cupertino'
  | 'field'
  | 'kraft'
  | 'oxide'
  | 'static'
  | 'sangria'
  | 'brass'
  | 'bronze'
  | 'velvet'
  | 'vision';

export const SKINS: { id: Skin; name: string; line: string; reference: string }[] = [
  { id: 'cloisonne', name: 'Cloisonné', line: 'Burnt orange and phthalo, enamel lit from inside', reference: 'Cloisonné enamel' },
  { id: 'letterpress', name: 'Letterpress', line: 'Press-blue ink on laid paper, set in a serif', reference: 'A letterpress proof' },
  { id: 'instrument', name: 'Instrument', line: 'Amber phosphor on a black panel, square and exact', reference: 'A cockpit panel' },
  { id: 'fjord', name: 'Fjord', line: 'Fog, birch and fjord blue, soft and unhurried', reference: 'A Nordic morning' },
  { id: 'contrast', name: 'High contrast', line: 'Black, white and one bright colour, for any light', reference: 'Signage, and a face drawn for legibility' },
  { id: 'nothing', name: 'Mono', line: 'Black, white and one red dot', reference: 'After Nothing OS' },
  { id: 'arc', name: 'Arc', line: 'Violet over a soft gradient space, in a lively grotesque', reference: 'After the Arc browser' },
  { id: 'cupertino', name: 'Cupertino', line: 'Grouped grey, white cards and system blue, in the system font', reference: 'After iOS' },
  { id: 'field', name: 'Field kit', line: 'Aluminium grey and international orange, with mono labels', reference: 'After Teenage Engineering' },
  { id: 'kraft', name: 'Kraft', line: 'Unbleached kraft and burgundy labels, quiet and square', reference: 'After Muji' },
  { id: 'oxide', name: 'Oxide', line: 'Iron oxide and moss, lit with pale ionized gold', reference: 'Ironheart Oxide, Mossy Anchor, Pale Ionized' },
  { id: 'static', name: 'Static', line: 'Black, electric citrine and a mist of lilac', reference: 'Static Void, Electric Citrine, Mist Lilac' },
  { id: 'sangria', name: 'Sangria', line: 'Sangria labels on pebble grey, with jade', reference: 'Sangria Deep, Jade Botanical, Pebble Mist' },
  { id: 'brass', name: 'Brass', line: 'Ash grey and antique brass on ivory', reference: 'Obsidian Ash, Antique Brass, Ivory Vapor' },
  { id: 'bronze', name: 'Bronze', line: 'Roasted bronze, cornsilk and glacial blue', reference: 'Sun-Roasted Bronze, Glacial Ether, Silk Cornsilk' },
  { id: 'velvet', name: 'Velvet', line: 'Ink black and almond, with velvet labels', reference: 'Obsidian Ink, Velvet Curfew, Almond Hearth' },
  { id: 'vision', name: 'Dusk', line: 'Warm graphite, blue and emerald, in Poppins', reference: 'After visionOS' },
];

/** The scheme an account has before it chooses one. */
export const DEFAULT_SKIN: Skin = 'vision';

const SKIN_KEY = 'planner.skin';

export function isSkin(v: unknown): v is Skin {
  return SKINS.some((s) => s.id === v);
}

export function readSkin(): Skin {
  try {
    const raw = localStorage.getItem(SKIN_KEY);
    return isSkin(raw) ? raw : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

/** Show a scheme now. Cloisonné is the tokens' own :root, so it is the absence of the attribute. */
export function applySkin(skin: Skin): void {
  const root = document.documentElement;
  if (skin === 'cloisonne') root.removeAttribute('data-skin');
  else root.setAttribute('data-skin', skin);
  syncChrome();
}

/** Remember a scheme on this device, for the pre-paint script, and show it. */
export function cacheSkin(skin: Skin): void {
  try {
    // Written even for Cloisonné: an empty key now means the default, Dusk.
    localStorage.setItem(SKIN_KEY, skin);
  } catch {
    // Not fatal: the account still holds it, and it applies after load.
  }
  applySkin(skin);
}

/* ============================================================================
   Themes: the material, chosen per account.

   Glass is frosted panels over a wallpaper, with the desk dashboard on a
   laptop (vision.css). Dot matrix is round-cornered slabs, dot numerals and a
   clock on Today (material.css). Plain is the scheme's own material. Root
   attribute `data-look`, absent for Plain.
   ========================================================================= */

export type Look = 'glass' | 'dots' | 'plain';

export const LOOKS: { id: Look; name: string; line: string }[] = [
  { id: 'glass', name: 'Glass', line: 'Frosted panels over a wallpaper, and a dashboard on a laptop' },
  { id: 'dots', name: 'Dot matrix', line: 'Round slabs, dot numerals and a clock on Today' },
  { id: 'plain', name: 'Plain', line: 'Just the colour scheme, on its own material' },
];

export const DEFAULT_LOOK: Look = 'glass';
const LOOK_KEY = 'planner.look';

export function isLook(v: unknown): v is Look {
  return LOOKS.some((l) => l.id === v);
}

export function readLook(): Look {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    return isLook(raw) ? raw : DEFAULT_LOOK;
  } catch {
    return DEFAULT_LOOK;
  }
}

export function applyLook(look: Look): void {
  const root = document.documentElement;
  if (look === 'plain') root.removeAttribute('data-look');
  else root.setAttribute('data-look', look);
}

export function cacheLook(look: Look): void {
  try {
    localStorage.setItem(LOOK_KEY, look);
  } catch {
    // Not fatal: the account still holds it.
  }
  applyLook(look);
}

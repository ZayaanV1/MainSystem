import { useSyncExternalStore } from 'react';

/**
 * How the app looks and moves on this device.
 *
 * Per device, for the reason the Week style and the theme are: a treatment
 * that is right on a laptop can be wrong on a phone, and an expensive one
 * (real glass on every surface) is a choice about this device's GPU, not
 * about the account.
 *
 * Rule 13: nothing visual is deleted; it becomes an option. Every treatment
 * that was replaced or toned down lives on here, so it can be switched back.
 */

/**
 * How a piece of work is drawn. The list row is the default since the iPhone
 * review (12 Oct 2026): a group of work is one surface with thin dividers,
 * the way iOS draws a list, and each row says its "when" once. The ticket and
 * the glass slip it replaced stay as choices (rule 13).
 */
export type SlipStyle = 'list' | 'ticket' | 'glass';
/** Where real backdrop-blur glass is drawn. Surfaces is the expensive one. */
export type GlassLevel = 'off' | 'bars' | 'surfaces';
/**
 * Full motion, the same moments without the flourishes, or none at all.
 * None is the one exception to rule 12, by the owner's choice (29 Oct 2026):
 * every change lands at once, with no entrance, slide or fade.
 */
export type MotionLevel = 'full' | 'calm' | 'none';
/** Vision's room behind the glass: the photo (the theme's or your own), or none. */
export type VisionBackground = 'photo' | 'off';
/** Vision's glass: light frost, or V7's darker smoke. */
export type VisionGlass = 'frost' | 'smoke';
/** Vision's navigation on a desk: the floating dock, or a full-height sidebar. */
export type VisionDock = 'floating' | 'full';
/**
 * How a change of screen is drawn. Quick plays the screen's own entrance and
 * never covers the page, so the next tap lands at once. Slide is the view
 * transition that carries the old screen away in the direction you moved; it
 * snapshots the whole page and takes touches for about 600 ms while it runs,
 * which showed as a delay when switching tabs quickly (Oct 2026). Kept as a
 * choice under rule 13.
 */
export type TabTransition = 'quick' | 'slide';

export interface Appearance {
  slip: SlipStyle;
  glass: GlassLevel;
  /** Glass that eases its blur in and out as surfaces appear. The most expensive option. */
  animatedBlur: boolean;
  motion: MotionLevel;
  tabs: TabTransition;
  /** Vision: how see-through its panels are, 0 (solid) to 100 (clearest). */
  visionClear: number;
  /** Vision: the frosting behind its panels, in px; 0 is none. */
  visionBlur: number;
  /** Vision: how far the room is dimmed behind the glass, 0 to 100. */
  visionDim: number;
  visionBackground: VisionBackground;
  /** Vision: cards rise under a mouse. */
  visionLift: boolean;
  visionGlass: VisionGlass;
  visionDock: VisionDock;
}

export const DEFAULT_APPEARANCE: Appearance = {
  slip: 'list',
  glass: 'bars',
  animatedBlur: false,
  motion: 'full',
  tabs: 'quick',
  visionClear: 50,
  visionBlur: 26,
  visionDim: 50,
  visionBackground: 'photo',
  visionLift: true,
  visionGlass: 'frost',
  visionDock: 'floating',
};

/** What each glass preset sets; the sliders stay free to move after. */
export const GLASS_PRESETS: Record<VisionGlass, Pick<Appearance, 'visionClear' | 'visionBlur' | 'visionDim'>> = {
  frost: { visionClear: 50, visionBlur: 26, visionDim: 50 },
  smoke: { visionClear: 60, visionBlur: 30, visionDim: 60 },
};

const steps = (to: number, by: number) => Array.from({ length: to / by + 1 }, (_, i) => i * by);

const KEY = 'planner.appearance';

const OPTIONS: { [K in keyof Appearance]: readonly Appearance[K][] } = {
  slip: ['list', 'ticket', 'glass'],
  glass: ['off', 'bars', 'surfaces'],
  animatedBlur: [true, false],
  motion: ['full', 'calm', 'none'],
  tabs: ['quick', 'slide'],
  visionClear: steps(100, 5),
  visionBlur: steps(40, 2),
  visionDim: steps(100, 5),
  visionBackground: ['photo', 'off'],
  visionLift: [true, false],
  visionGlass: ['frost', 'smoke'],
  visionDock: ['floating', 'full'],
};

/**
 * The stored shape's version. Before 2, every save wrote the whole object, so
 * a device that had only ever changed the glass also had `slip: 'ticket'`
 * stored, and the new default would never have reached it. A version-1 value
 * keeps everything except the slip, once; a slip chosen after that is kept.
 */
const VERSION = 2;

/** Keeps every known field that holds a known value; anything else falls back. */
export function parseAppearance(raw: string | null): Appearance {
  const out: Appearance = { ...DEFAULT_APPEARANCE };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    for (const k of Object.keys(OPTIONS) as (keyof Appearance)[]) {
      if (k === 'slip' && v.version !== VERSION) continue;
      if ((OPTIONS[k] as readonly unknown[]).includes(v[k])) (out as unknown as Record<string, unknown>)[k] = v[k];
    }
  } catch {
    // A corrupt value is the defaults, not a crash.
  }
  return out;
}

let current: Appearance = read();
const listeners = new Set<() => void>();

function read(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Mirrors the choices onto <html> so CSS can follow them without React. */
function apply(a: Appearance) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.glass = a.glass;
  root.dataset.motion = a.motion;
  if (a.animatedBlur) root.dataset.animatedBlur = 'true';
  else delete root.dataset.animatedBlur;

  // Vision reads these; every other theme ignores them (vision.css).
  root.style.setProperty('--v-alpha', String(Math.round((0.85 - a.visionClear * 0.008) * 1000) / 1000));
  root.style.setProperty('--v-blur', `${a.visionBlur}px`);
  root.style.setProperty('--v-dim', String(a.visionDim / 100));
  root.dataset.vBg = a.visionBackground;
  root.dataset.vLift = String(a.visionLift);
  root.dataset.vGlass = a.visionGlass;
  root.dataset.vDock = a.visionDock;
  // Very clear glass over a bright room: text takes a shadow to stay legible.
  root.dataset.vClear = a.visionClear >= 70 ? 'high' : 'normal';
}
apply(current);

/*
 * Motion: None reaches the animations played from JavaScript as well as the
 * CSS ones (index.css). Sixteen call sites animate elements directly; rather
 * than teach each one, every animation asked for while None is chosen runs
 * in no time and lands where it was going. A loop runs once, at no length.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function') {
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    if (document.documentElement.dataset.motion !== 'none') return animate.call(this, keyframes, options);
    const o: KeyframeAnimationOptions = typeof options === 'number' ? {} : { ...(options ?? {}) };
    return animate.call(this, keyframes, { ...o, duration: 0, delay: 0, endDelay: 0, iterations: 1 });
  };
}

export function getAppearance(): Appearance {
  return current;
}

export function setAppearance(patch: Partial<Appearance>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...current, version: VERSION }));
  } catch {
    // Storage unavailable: the choice holds for this session.
  }
  apply(current);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance, getAppearance);
}

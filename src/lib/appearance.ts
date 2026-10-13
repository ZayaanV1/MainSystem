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
/** Full motion, or the same moments without the flourishes. */
export type MotionLevel = 'full' | 'calm';

export interface Appearance {
  slip: SlipStyle;
  glass: GlassLevel;
  /** Glass that eases its blur in and out as surfaces appear. The most expensive option. */
  animatedBlur: boolean;
  motion: MotionLevel;
}

export const DEFAULT_APPEARANCE: Appearance = {
  slip: 'list',
  glass: 'bars',
  animatedBlur: false,
  motion: 'full',
};

const KEY = 'planner.appearance';

const OPTIONS: { [K in keyof Appearance]: readonly Appearance[K][] } = {
  slip: ['list', 'ticket', 'glass'],
  glass: ['off', 'bars', 'surfaces'],
  animatedBlur: [true, false],
  motion: ['full', 'calm'],
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
}
apply(current);

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

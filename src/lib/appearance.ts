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

export type SlipStyle = 'ticket' | 'glass';
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
  slip: 'ticket',
  glass: 'bars',
  animatedBlur: false,
  motion: 'full',
};

const KEY = 'planner.appearance';

const OPTIONS: { [K in keyof Appearance]: readonly Appearance[K][] } = {
  slip: ['ticket', 'glass'],
  glass: ['off', 'bars', 'surfaces'],
  animatedBlur: [true, false],
  motion: ['full', 'calm'],
};

/** Keeps every known field that holds a known value; anything else falls back. */
export function parseAppearance(raw: string | null): Appearance {
  const out: Appearance = { ...DEFAULT_APPEARANCE };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    for (const k of Object.keys(OPTIONS) as (keyof Appearance)[]) {
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
    localStorage.setItem(KEY, JSON.stringify(current));
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

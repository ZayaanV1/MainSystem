import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { cacheSkin, isSkin, readSkin, type Skin } from './theme';

/**
 * What the account has chosen about how the app looks and is arranged: the
 * theme, the order and visibility of Today's sections, and the modules that
 * are switched off.
 *
 * Per account (app_settings, migration 0036), so the phone and the laptop
 * agree; cached on the device so the first frame is already right and an
 * offline open keeps the arrangement. Hiding never deletes anything: these are
 * lists of what not to show, and clearing them brings everything back.
 */

/**
 * Today's sections, in their default order.
 *
 * Since 19 Oct 2026 Today is the widget board and the two things done from it
 * many times a day: catching a thought and ticking the checklist. Everything
 * dated (the work list, what is ahead, the briefing about it, the inbox to
 * sort into it) lives on Schedule. A saved order naming those sections simply
 * drops them (normalise keeps known names only).
 */
export const TODAY_SECTIONS = ['board', 'capture', 'checklist'] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];

/**
 * Sections that cannot be hidden: the board is what answers "what do I do
 * now" (rule 1), and a Today without a way to catch a thought loses it.
 */
export const ALWAYS_SHOWN: ReadonlySet<TodaySection> = new Set(['board', 'capture']);

/** Whole features that can be switched off. Off hides; the data stays. */
export const MODULES = ['abood', 'assist', 'grades', 'series', 'feeds'] as const;
export type Module = (typeof MODULES)[number];

export interface Preferences {
  skin: Skin;
  order: TodaySection[];
  hidden: TodaySection[];
  modulesOff: Module[];
}

const KEY = 'planner.prefs';

/** Keep only known names, in a valid order, with every section present once. */
export function normalise(raw: Partial<{ order: unknown; hidden: unknown; modulesOff: unknown }>): Omit<Preferences, 'skin'> {
  const known = (v: unknown, list: readonly string[]) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && list.includes(x)))] : [];
  const order = known(raw.order, TODAY_SECTIONS) as TodaySection[];
  // A section missing from a saved order (one added later) takes its default
  // place relative to the sections around it.
  for (const s of TODAY_SECTIONS) {
    if (order.includes(s)) continue;
    const before = TODAY_SECTIONS.slice(0, TODAY_SECTIONS.indexOf(s)).reverse().find((x) => order.includes(x));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, s);
  }
  const hidden = (known(raw.hidden, TODAY_SECTIONS) as TodaySection[]).filter((s) => !ALWAYS_SHOWN.has(s));
  return { order, hidden, modulesOff: known(raw.modulesOff, MODULES) as Module[] };
}

function readCache(): Preferences {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    // A bad or missing cache: the defaults.
  }
  return { skin: readSkin(), ...normalise(raw) };
}

let state: Preferences = readCache();
const listeners = new Set<() => void>();

function set(next: Preferences) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify({ order: next.order, hidden: next.hidden, modulesOff: next.modulesOff }));
  } catch {
    // Not fatal: the account holds it.
  }
  listeners.forEach((l) => l());
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export const preferences = () => state;
export const moduleOn = (m: Module, prefs: Preferences = state) => !prefs.modulesOff.includes(m);

/**
 * Read the account's choices once it is signed in. A failed read changes
 * nothing: the cached choices stand rather than being replaced by defaults.
 */
export async function adoptPreferences(): Promise<void> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('theme, today_order, today_hidden, modules_off')
    .limit(1);
  if (error || !data?.[0]) return;
  const row = data[0] as { theme: string | null; today_order: unknown; today_hidden: unknown; modules_off: unknown };
  const skin = isSkin(row.theme) ? row.theme : 'cloisonne';
  cacheSkin(skin);
  set({ skin, ...normalise({ order: row.today_order, hidden: row.today_hidden, modulesOff: row.modules_off }) });
}

async function save(userId: string, patch: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('app_settings').update(patch).eq('user_id', userId);
  return { error: error ? 'Couldn’t save that. It applies on this device until you try again.' : null };
}

export async function saveSkin(userId: string, skin: Skin) {
  cacheSkin(skin);
  set({ ...state, skin });
  return save(userId, { theme: skin === 'cloisonne' ? null : skin });
}

export async function saveTodayLayout(userId: string, order: TodaySection[], hidden: TodaySection[]) {
  const next = normalise({ order, hidden, modulesOff: state.modulesOff });
  set({ ...state, order: next.order, hidden: next.hidden });
  const isDefault = next.order.every((s, i) => s === TODAY_SECTIONS[i]);
  return save(userId, { today_order: isDefault ? null : next.order, today_hidden: next.hidden });
}

export async function saveModulesOff(userId: string, modulesOff: Module[]) {
  const next = normalise({ order: state.order, hidden: state.hidden, modulesOff });
  set({ ...state, modulesOff: next.modulesOff });
  return save(userId, { modules_off: next.modulesOff });
}

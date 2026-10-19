import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

/**
 * The widget board at the top of Today: what is on it, in what order, at
 * what size.
 *
 * Built from the approved "Today Pegboard" prototype (Oct 2026). A board is
 * an ordered list. The grid packs it four cells wide with `grid-auto-flow:
 * dense`, so a peg can fill the gap beside a small widget and nothing here
 * stores coordinates: order is the whole layout, which is why dragging is a
 * move within a list and why a phone and a laptop agree on it.
 *
 * Per account (app_settings.board, migration 0040), like the theme and the
 * section order, and cached on the device so the first frame is already
 * right. Null in the database means the default board.
 */

export type WidgetType =
  | 'due' | 'work' | 'now' | 'list' | 'class'
  | 'week' | 'month' | 'agenda' | 'exams'
  | 'clock' | 'clockday' | 'count' | 'focus' | 'term'
  | 'goal' | 'grades'
  | 'capture'
  | 'photo' | 'music' | 'link';

export type WidgetSize = 'peg' | 'strip' | 's' | 'tall' | 'm' | 'l';

export interface Widget {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  /** A few strings: a clock face, a countdown's title and day, a link. */
  opts: Record<string, string>;
}

/** Columns and rows each size spans on a grid four cells wide. */
export const SIZE_SPAN: Record<WidgetSize, readonly [number, number]> = {
  peg: [1, 1],
  strip: [4, 1],
  s: [2, 2],
  tall: [2, 4],
  m: [4, 2],
  l: [4, 4],
};

export const SIZE_ORDER: readonly WidgetSize[] = ['peg', 'strip', 's', 'tall', 'm', 'l'];

export const SIZE_NAME: Record<WidgetSize, string> = {
  peg: 'Peg',
  strip: 'Strip',
  s: 'Small',
  tall: 'Tall',
  m: 'Medium',
  l: 'Large',
};

/** The sizes each widget is drawn for. The first is never assumed; see `defaultSize`. */
export const SIZES: Record<WidgetType, readonly WidgetSize[]> = {
  due: ['peg', 'strip', 's', 'm'],
  work: ['s', 'tall', 'm', 'l'],
  now: ['s', 'm'],
  list: ['s', 'm'],
  class: ['strip', 's', 'm'],
  week: ['m', 'tall', 'l'],
  month: ['s', 'm', 'tall', 'l'],
  agenda: ['tall', 'l'],
  exams: ['s', 'm'],
  clock: ['peg', 'strip', 's', 'm', 'l'],
  clockday: ['m', 'tall', 'l'],
  count: ['peg', 'strip', 's', 'm'],
  focus: ['peg', 'strip', 's'],
  term: ['peg', 'strip', 's'],
  goal: ['peg', 's', 'm'],
  grades: ['s', 'm'],
  capture: ['strip', 's'],
  photo: ['peg', 's', 'tall', 'm', 'l'],
  music: ['s', 'm'],
  link: ['peg', 's'],
};

export const WIDGET_TYPES = Object.keys(SIZES) as WidgetType[];

/** The size a widget arrives at from the gallery: small where it has one. */
export function defaultSize(type: WidgetType): WidgetSize {
  const sizes = SIZES[type];
  return sizes.includes('s') ? 's' : sizes.includes('m') ? 'm' : sizes[0];
}

/** A board holds at most this many widgets; the column's check says 60. */
export const MAX_WIDGETS = 40;

/** Photos are stored, and the free tier's storage is one shared pool. */
export const MAX_PHOTOS = 6;

/**
 * The board a new account starts with: what is due next and the week ahead,
 * which answer "what now" before anything is set up (rule 1), and a clock.
 * Every one of them reads the account's own data and says so honestly when
 * there is none.
 */
export const DEFAULT_BOARD: readonly Widget[] = [
  { id: 'd-due', type: 'due', size: 's', opts: {} },
  { id: 'd-clock', type: 'clock', size: 's', opts: { face: 'analog' } },
  { id: 'd-week', type: 'week', size: 'm', opts: {} },
];

const isType = (v: unknown): v is WidgetType => typeof v === 'string' && v in SIZES;

/**
 * Keep only what the app can draw: known types, a size the type supports
 * (the nearest larger one, else its default), string options, unique ids,
 * and no more than MAX_WIDGETS. A widget type removed in a later release
 * simply drops off rather than breaking the board.
 */
export function normaliseBoard(raw: unknown): Widget[] {
  if (!Array.isArray(raw)) return DEFAULT_BOARD.map((w) => ({ ...w, opts: { ...w.opts } }));
  const seen = new Set<string>();
  const out: Widget[] = [];
  for (const item of raw) {
    if (out.length >= MAX_WIDGETS) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!isType(r.type)) continue;
    let id = typeof r.id === 'string' && r.id ? r.id : '';
    if (!id || seen.has(id)) id = newWidgetId();
    seen.add(id);
    const sizes = SIZES[r.type];
    let size = (typeof r.size === 'string' && (SIZE_ORDER as string[]).includes(r.size) ? r.size : '') as WidgetSize | '';
    if (!size || !sizes.includes(size)) {
      const want = size ? SIZE_ORDER.indexOf(size) : -1;
      size = sizes.find((s) => SIZE_ORDER.indexOf(s) >= want) ?? defaultSize(r.type);
    }
    const opts: Record<string, string> = {};
    if (r.opts && typeof r.opts === 'object') {
      for (const [k, v] of Object.entries(r.opts as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length <= 600) opts[k] = v;
      }
    }
    out.push({ id, type: r.type, size, opts });
  }
  return out;
}

export function newWidgetId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The list with one widget moved to `index`, every other widget in its order. */
export function moveWidget(board: readonly Widget[], id: string, index: number): Widget[] {
  const from = board.findIndex((w) => w.id === id);
  if (from < 0) return [...board];
  const next = [...board];
  const [w] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(index, next.length)), 0, w);
  return next;
}

export interface Box {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a widget dragged to (x, y) belongs, as an index into the board
 * WITHOUT the dragged widget.
 *
 * The nearest other widget decides it, rows first. A widget the full width of the board
 * splits top and bottom: above its middle goes before it. Anything narrower
 * splits left and right, the way a row of apps does on a phone's home
 * screen, and a pointer clear above or below it goes before or after.
 * `boxes` are in board order and need not include the dragged widget.
 */
export function insertionIndex(boxes: readonly Box[], x: number, y: number, dragId: string, boardWidth: number): number {
  const others = boxes.filter((b) => b.id !== dragId);
  if (others.length === 0) return 0;
  let best = 0;
  let bestDistance = Infinity;
  others.forEach((b, i) => {
    const dx = Math.max(b.left - x, 0, x - b.right);
    const dy = Math.max(b.top - y, 0, y - b.bottom);
    // Vertical distance counts double, so a neighbour in the same row beats
    // one the same distance away in the next: a widget held in its own gap
    // stays in its row instead of jumping below the widget underneath.
    const d = Math.hypot(dx, dy * 2);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  const b = others[best];
  const wide = b.right - b.left > boardWidth * 0.7;
  const after = wide
    ? y > (b.top + b.bottom) / 2
    : y > b.bottom
      ? true
      : y < b.top
        ? false
        : x > (b.left + b.right) / 2;
  return best + (after ? 1 : 0);
}

/** How many photo widgets the board holds, for the cap. */
export function photoCount(board: readonly Widget[]): number {
  return board.filter((w) => w.type === 'photo').length;
}

/* ------------------------------------------------------------- the store --- */

const KEY = 'planner.board';

function readCache(): Widget[] {
  try {
    const raw = localStorage.getItem(KEY);
    return normaliseBoard(raw ? JSON.parse(raw) : null);
  } catch {
    return normaliseBoard(null);
  }
}

let state: Widget[] = readCache();
/** Whether the account's own board has been read this session. */
let adopted = false;
const listeners = new Set<() => void>();

function set(next: Widget[]) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not fatal: the account holds it.
  }
  listeners.forEach((l) => l());
}

export function useBoard(): Widget[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/**
 * Read the account's board. A failed read changes nothing: the cached board
 * stands rather than being replaced by the default, which would look like a
 * board quietly wiped.
 */
export async function adoptBoard(): Promise<void> {
  if (adopted) return;
  const { data, error } = await supabase.from('app_settings').select('board').limit(1);
  if (error || !data?.[0]) return;
  adopted = true;
  set(normaliseBoard((data[0] as { board: unknown }).board));
}

/**
 * Save the whole board. Applied on the device at once; the error, if any,
 * says the change holds here until it can be saved.
 */
export async function saveBoard(userId: string, next: Widget[]): Promise<{ error: string | null }> {
  const clean = normaliseBoard(next);
  set(clean);
  const { error } = await supabase.from('app_settings').update({ board: clean }).eq('user_id', userId);
  return { error: error ? 'Couldn’t save the board. It stays like this on this device until you try again.' : null };
}

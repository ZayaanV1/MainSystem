import { supabase } from './supabase';
import { todayKey, type DayKey } from './time';
import type { DayPoint } from './trend';
import { itemRows, totals, type FoodRowInput } from '../../supabase/functions/_shared/food';

/**
 * Data access for the food log.
 *
 * Writes here go straight to Supabase rather than through the outbox, unlike
 * the planner. Two reasons: macro totals are read back and summed immediately,
 * so an optimistic write would show numbers that might later change; and every
 * food write already sits behind an explicit confirmation, so there is no
 * half-typed thought at risk of evaporating while it syncs.
 */

export interface MacroBand {
  min: number;
  max: number;
}

export interface MacroTargets {
  effective_from: DayKey;
  calories: MacroBand;
  protein: MacroBand;
  carbs: MacroBand;
  fat: MacroBand;
}

export interface FoodItem {
  id: string;
  entry_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  is_estimate: boolean;
  source_ref: string | null;
  position: number;
}

export interface FoodEntry {
  id: string;
  local_day: DayKey;
  logged_at: string;
  source: 'manual' | 'ai' | 'barcode' | 'photo' | 'saved';
  raw_text: string | null;
}

export interface SavedMeal {
  id: string;
  name: string;
  items: Omit<FoodItem, 'id' | 'entry_id' | 'position'>[];
  times_logged: number;
  last_used_at: string | null;
}

export interface DietDay {
  day: DayKey;
  entries: FoodEntry[];
  items: FoodItem[];
  targets: MacroTargets | null;
  savedMeals: SavedMeal[];
  weightKg: number | null;
}

/** Postgres numeric comes back as a string; every macro goes through here. */
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/**
 * The targets in force on a given day.
 *
 * Reads the most recent version effective on or before that day, so a change
 * made today never rewrites whether last month was on target.
 */
export async function targetsFor(day: DayKey): Promise<MacroTargets | null> {
  const { data } = await supabase
    .from('macro_targets')
    .select('*')
    .lte('effective_from', day)
    .order('effective_from', { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  return {
    effective_from: row.effective_from,
    calories: { min: num(row.calories_min), max: num(row.calories_max) },
    protein: { min: num(row.protein_min), max: num(row.protein_max) },
    carbs: { min: num(row.carbs_min), max: num(row.carbs_max) },
    fat: { min: num(row.fat_min), max: num(row.fat_max) },
  };
}

/**
 * Writes a new version of the macro targets, effective from a day.
 *
 * An upsert on (user_id, effective_from) rather than an update, so changing
 * today's targets twice replaces today's row instead of accumulating two, but
 * changing them tomorrow leaves today's alone. That is the whole point of the
 * versioning: last month has to keep meaning what it meant last month.
 *
 * Editing a past effective date is deliberately possible — correcting a target
 * you set wrong is different from rewriting history, and refusing it would
 * leave no way to fix a typo that has already governed a week.
 */
export async function saveTargets(
  userId: string,
  effectiveFrom: DayKey,
  bands: { calories: MacroBand; protein: MacroBand; carbs: MacroBand; fat: MacroBand },
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('macro_targets').upsert(
    {
      user_id: userId,
      effective_from: effectiveFrom,
      calories_min: bands.calories.min,
      calories_max: bands.calories.max,
      protein_min: bands.protein.min,
      protein_max: bands.protein.max,
      carbs_min: bands.carbs.min,
      carbs_max: bands.carbs.max,
      fat_min: bands.fat.min,
      fat_max: bands.fat.max,
    },
    { onConflict: 'user_id,effective_from' },
  );

  return { error: error ? error.message : null };
}

/** Every version, newest first, for the history the editor shows. */
export async function loadTargetHistory(): Promise<MacroTargets[]> {
  const { data } = await supabase
    .from('macro_targets')
    .select('*')
    .order('effective_from', { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    effective_from: row.effective_from as DayKey,
    calories: { min: num(row.calories_min), max: num(row.calories_max) },
    protein: { min: num(row.protein_min), max: num(row.protein_max) },
    carbs: { min: num(row.carbs_min), max: num(row.carbs_max) },
    fat: { min: num(row.fat_min), max: num(row.fat_max) },
  }));
}

export async function loadDay(day: DayKey = todayKey()): Promise<DietDay> {
  const [entries, targets, meals, weight] = await Promise.all([
    supabase
      .from('food_entries')
      .select('id, local_day, logged_at, source, raw_text, food_items(*)')
      .eq('local_day', day)
      .order('logged_at', { ascending: true }),
    targetsFor(day),
    supabase
      .from('saved_meals')
      .select('id, name, items, times_logged, last_used_at')
      .order('last_used_at', { ascending: false, nullsFirst: false }),
    supabase.from('bodyweight').select('kg').eq('local_day', day).limit(1),
  ]);

  const rows = (entries.data ?? []) as (FoodEntry & { food_items: Record<string, unknown>[] })[];

  const items: FoodItem[] = rows.flatMap((e) =>
    (e.food_items ?? []).map((i) => ({
      id: i.id as string,
      entry_id: e.id,
      name: i.name as string,
      quantity: i.quantity === null ? null : num(i.quantity),
      unit: (i.unit as string) ?? null,
      grams: i.grams === null ? null : num(i.grams),
      calories: num(i.calories),
      protein_g: num(i.protein_g),
      carbs_g: num(i.carbs_g),
      fat_g: num(i.fat_g),
      is_estimate: Boolean(i.is_estimate),
      source_ref: (i.source_ref as string) ?? null,
      position: Number(i.position ?? 0),
    })),
  );

  return {
    day,
    entries: rows.map(({ food_items: _ignored, ...e }) => e),
    items,
    targets,
    savedMeals: ((meals.data ?? []) as SavedMeal[]).map((m) => ({
      ...m,
      items: (m.items ?? []) as SavedMeal['items'],
    })),
    weightKg: weight.data?.[0] ? num(weight.data[0].kg) : null,
  };
}

/** Alias kept so callers read as "a new item", not "a row input". */
export type NewItem = FoodRowInput;

/**
 * Writes one logging action and its items.
 *
 * The entry is created first so the items have something to hang from; if the
 * item insert fails the entry is removed rather than left as an empty meal
 * that silently contributes nothing and cannot be explained later.
 */
export async function logEntry(
  userId: string,
  day: DayKey,
  source: FoodEntry['source'],
  items: NewItem[],
  rawText?: string | null,
): Promise<{ error: string | null }> {
  if (items.length === 0) return { error: 'Nothing to log.' };

  const { data: entry, error: entryError } = await supabase
    .from('food_entries')
    .insert({ user_id: userId, local_day: day, source, raw_text: rawText ?? null })
    .select('id')
    .single();

  if (entryError || !entry) return { error: entryError?.message ?? 'Could not start the entry.' };

  const { error: itemError } = await supabase
    .from('food_items')
    .insert(itemRows(userId, entry.id, items));

  if (itemError) {
    await supabase.from('food_entries').delete().eq('id', entry.id);
    return { error: itemError.message };
  }

  return { error: null };
}

/** Removes a logging action and everything in it, as one undo. */
export async function deleteEntry(entryId: string): Promise<void> {
  await supabase.from('food_entries').delete().eq('id', entryId);
}

export async function saveMeal(userId: string, name: string, items: NewItem[]): Promise<{ error: string | null }> {
  const { error } = await supabase.from('saved_meals').upsert(
    { user_id: userId, name: name.trim(), items },
    { onConflict: 'user_id,name' },
  );
  return { error: error ? error.message : null };
}

/**
 * Distinct items logged recently, most recent first.
 *
 * For the one-tap re-log chips. Deduplicated by name so a breakfast eaten
 * every day appears once rather than filling the row with itself, keeping the
 * most recent version of its macros — if the same food was logged at two
 * weights, the last one is the better guess at what "again" means.
 *
 * Today is excluded. A chip offering to re-log something already on today's
 * list is mostly a way to log it twice by accident.
 */
export async function loadRecentItems(
  beforeDay: DayKey,
  sinceDay: DayKey,
  limit = 8,
): Promise<NewItem[]> {
  const { data } = await supabase
    .from('food_entries')
    .select('local_day, logged_at, food_items(name, quantity, unit, grams, calories, protein_g, carbs_g, fat_g, is_estimate, source_ref)')
    .gte('local_day', sinceDay)
    .lt('local_day', beforeDay)
    .order('logged_at', { ascending: false });

  const rows = (data ?? []) as { food_items: Record<string, unknown>[] | null }[];
  const seen = new Map<string, NewItem>();

  for (const row of rows) {
    for (const raw of row.food_items ?? []) {
      const name = String(raw.name ?? '').trim();
      if (!name) continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;

      seen.set(key, {
        name,
        quantity: raw.quantity === null ? null : num(raw.quantity),
        unit: (raw.unit as string) ?? null,
        grams: raw.grams === null ? null : num(raw.grams),
        calories: num(raw.calories),
        protein_g: num(raw.protein_g),
        carbs_g: num(raw.carbs_g),
        fat_g: num(raw.fat_g),
        is_estimate: Boolean(raw.is_estimate),
        source_ref: (raw.source_ref as string) ?? null,
      });

      if (seen.size >= limit) return [...seen.values()];
    }
  }

  return [...seen.values()];
}

/** Logs a single item again, at a portion of what it was. */
export async function relogItem(
  userId: string,
  day: DayKey,
  item: NewItem,
  portion = 1,
): Promise<{ error: string | null }> {
  return logEntry(userId, day, 'manual', [scaleItem(item, portion)], null);
}

/**
 * Scales one item's measured amounts.
 *
 * Multiplies what was recorded rather than re-deriving anything, so half a
 * portion of something weighed once stays exactly half of what was weighed.
 */
function scaleItem<T extends NewItem>(item: T, portion: number): T {
  if (portion === 1) return item;
  return {
    ...item,
    quantity: item.quantity === null || item.quantity === undefined ? null : round(item.quantity * portion),
    grams: item.grams === null || item.grams === undefined ? null : round(item.grams * portion),
    calories: round(item.calories * portion),
    protein_g: round(item.protein_g * portion),
    carbs_g: round(item.carbs_g * portion),
    fat_g: round(item.fat_g * portion),
  };
}

/** Forgets a saved meal. The entries it already produced are untouched. */
export async function deleteSavedMeal(id: string): Promise<void> {
  await supabase.from('saved_meals').delete().eq('id', id);
}

/**
 * Re-logs a saved meal, optionally scaled.
 *
 * Scaling multiplies the stored macros rather than re-deriving them, so half a
 * portion of something weighed once stays exactly half of what was weighed.
 */
export async function logSavedMeal(
  userId: string,
  day: DayKey,
  meal: SavedMeal,
  portion = 1,
): Promise<{ error: string | null }> {
  const scaled = meal.items.map((i) => scaleItem(i, portion));

  // The portion is written into the entry's own record of itself, so a half
  // shake is still legible as a half shake a month later rather than as a
  // meal whose numbers mysteriously disagree with the saved one.
  const label = portion === 1 ? meal.name : `${meal.name} · ${portion}x`;
  const result = await logEntry(userId, day, 'saved', scaled, label);
  if (result.error) return result;

  await supabase
    .from('saved_meals')
    .update({ times_logged: meal.times_logged + 1, last_used_at: new Date().toISOString() })
    .eq('id', meal.id);

  return { error: null };
}

const round = (n: number) => Math.round(n * 10) / 10;

export async function setWeight(userId: string, day: DayKey, kg: number): Promise<void> {
  await supabase
    .from('bodyweight')
    .upsert({ user_id: userId, local_day: day, kg }, { onConflict: 'user_id,local_day' });
}

/**
 * Daily weight and calories over a window, for the weekly trend.
 *
 * Two queries rather than a join: food_items has no local_day of its own, and
 * pushing the grouping into Postgres would mean a view to maintain for a few
 * hundred rows. One user, a few thousand rows — this is fast enough and stays
 * readable.
 */
export async function loadTrendDays(fromDay: DayKey, toDay: DayKey): Promise<DayPoint[]> {
  const [weights, entries] = await Promise.all([
    supabase
      .from('bodyweight')
      .select('local_day, kg')
      .gte('local_day', fromDay)
      .lte('local_day', toDay),
    supabase
      .from('food_entries')
      .select('local_day, food_items(calories)')
      .gte('local_day', fromDay)
      .lte('local_day', toDay),
  ]);

  const byDay = new Map<DayKey, DayPoint>();
  const at = (day: DayKey): DayPoint => {
    const existing = byDay.get(day);
    if (existing) return existing;
    const fresh: DayPoint = { day };
    byDay.set(day, fresh);
    return fresh;
  };

  for (const row of (weights.data ?? []) as { local_day: DayKey; kg: unknown }[]) {
    at(row.local_day).kg = num(row.kg);
  }

  for (const row of (entries.data ?? []) as {
    local_day: DayKey;
    food_items: { calories: unknown }[] | null;
  }[]) {
    const day = at(row.local_day);
    const sum = (row.food_items ?? []).reduce((n, i) => n + num(i.calories), 0);
    day.calories = (day.calories ?? 0) + sum;
  }

  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Day totals, rounded once at the end rather than at every addition. */
export function dayTotals(items: FoodItem[]) {
  return totals(items);
}

import { supabase } from './supabase';
import { todayKey, type DayKey } from './time';
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
  const scaled = meal.items.map((i) => ({
    ...i,
    quantity: i.quantity === null ? null : round(i.quantity * portion),
    grams: i.grams === null ? null : round(i.grams * portion),
    calories: round(i.calories * portion),
    protein_g: round(i.protein_g * portion),
    carbs_g: round(i.carbs_g * portion),
    fat_g: round(i.fat_g * portion),
  }));

  const result = await logEntry(userId, day, 'saved', scaled, meal.name);
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

/** Day totals, rounded once at the end rather than at every addition. */
export function dayTotals(items: FoodItem[]) {
  return totals(items);
}

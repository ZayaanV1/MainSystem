import type { NewItem } from './diet';

/**
 * USDA FoodData Central search.
 *
 * The spec asks for confident database matches to be preferred over model
 * guesses, and this is the database for unbranded food: "150g chicken breast"
 * has a real measured answer, and asking a language model to recall it is
 * strictly worse than looking it up.
 *
 * Two things about this data are not obvious and both will put wrong numbers
 * in the log if ignored:
 *
 *   Energy is often absent from nutrient 208. Foundation foods carry it under
 *   957 and 958 instead — the Atwater general and specific factors. A search
 *   for "chicken breast raw" returns three results and the first two have no
 *   208 at all, so reading only that field silently drops the best matches.
 *
 *   "Carbohydrate, by difference" is computed by subtracting everything else
 *   from the total mass, so it goes slightly negative on high-protein foods.
 *   A real result returns -0.428 g of carbohydrate. That is a rounding
 *   artifact of the method, not a measurement, and it is clamped to zero.
 *
 * The key is a rate-limit key rather than a secret, so it ships in the bundle.
 * DEMO_KEY works out of the box at about 30 requests an hour; a free key from
 * api.data.gov raises that to 1,000 and is set as VITE_USDA_API_KEY.
 */

const ENDPOINT = 'https://api.nal.usda.gov/fdc/v1/foods/search';

const API_KEY = import.meta.env.VITE_USDA_API_KEY || 'DEMO_KEY';

/**
 * Foundation and SR Legacy only.
 *
 * Branded foods are excluded deliberately: they are barcode territory, where
 * Open Food Facts already gives an exact panel, and including them floods a
 * search for "chicken breast" with two hundred supermarket ready meals.
 */
const DATA_TYPES = 'Foundation,SR Legacy';

export interface UsdaFood {
  fdcId: number;
  description: string;
  /** Foundation is measured directly; SR Legacy is the older reference set. */
  dataType: string;
  /** Per 100 g, always. */
  per100g: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
}

interface RawNutrient {
  nutrientNumber?: string;
  value?: number;
  unitName?: string;
}

/** Reads one nutrient by its USDA number, in the unit expected. */
function nutrient(list: RawNutrient[], numbers: string[], unit: string): number | null {
  for (const number of numbers) {
    const hit = list.find((n) => n.nutrientNumber === number);
    if (!hit || typeof hit.value !== 'number' || !Number.isFinite(hit.value)) continue;
    // The unit is checked rather than assumed: reading milligrams as grams
    // would inflate a macro by a thousand and look almost plausible.
    if ((hit.unitName ?? '').toUpperCase() !== unit) continue;
    return hit.value;
  }
  return null;
}

/**
 * Grams of a macro, with the by-difference artifact handled.
 *
 * A small negative is clamped to zero. Anything below -1 g is treated as
 * missing instead, because that is no longer a rounding artifact and there is
 * no honest way to guess what it should have been.
 */
function macroGrams(list: RawNutrient[], numbers: string[]): number | null {
  const value = nutrient(list, numbers, 'G');
  if (value === null) return null;
  if (value < -1) return null;
  return Math.max(0, Math.round(value * 10) / 10);
}

export function readFood(raw: unknown): UsdaFood | null {
  const food = raw as {
    fdcId?: number;
    description?: string;
    dataType?: string;
    foodNutrients?: RawNutrient[];
  };

  const description = String(food?.description ?? '').trim();
  if (!food?.fdcId || !description) return null;

  const list = food.foodNutrients ?? [];

  // 208 is the plain energy field. 958 and 957 are the Atwater specific and
  // general factors, which is where Foundation foods keep theirs. Specific is
  // preferred over general: it uses per-food coefficients rather than 4/4/9.
  const calories = nutrient(list, ['208', '958', '957'], 'KCAL');
  const protein = macroGrams(list, ['203']);
  const carbs = macroGrams(list, ['205']);
  const fat = macroGrams(list, ['204']);

  // Without energy and at least one macro there is nothing worth logging, and
  // a row of zeroes that looks like data is worse than no result.
  if (calories === null || (protein === null && carbs === null && fat === null)) return null;

  return {
    fdcId: food.fdcId,
    description,
    dataType: String(food.dataType ?? ''),
    per100g: {
      calories: Math.round(calories),
      protein_g: protein ?? 0,
      carbs_g: carbs ?? 0,
      fat_g: fat ?? 0,
    },
  };
}

export type UsdaResult =
  | { ok: true; foods: UsdaFood[] }
  | { ok: false; reason: string };

export async function searchFoods(query: string, limit = 8): Promise<UsdaResult> {
  const q = query.trim();
  if (q.length < 2) return { ok: false, reason: 'Type at least two letters to search.' };

  const url =
    `${ENDPOINT}?api_key=${encodeURIComponent(API_KEY)}` +
    `&query=${encodeURIComponent(q)}` +
    `&pageSize=${limit * 3}` +
    `&dataType=${encodeURIComponent(DATA_TYPES)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    return { ok: false, reason: "Couldn't reach the food database. Add it by hand, or try again." };
  }

  if (res.status === 429) {
    return {
      ok: false,
      reason: 'The food database is rate limited for now. Add it by hand, or try later.',
    };
  }

  if (!res.ok) {
    return { ok: false, reason: `The food database returned ${res.status}. Add it by hand.` };
  }

  let body: { foods?: unknown[] };
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'The food database returned something unreadable. Add it by hand.' };
  }

  // Over-fetched above because unusable rows are dropped here rather than
  // shown as empty ones, and a page of eight can lose several.
  const foods = (body.foods ?? [])
    .map(readFood)
    .filter((f): f is UsdaFood => f !== null)
    .slice(0, limit);

  if (foods.length === 0) {
    return { ok: false, reason: `Nothing usable found for "${q}". Add it by hand.` };
  }

  return { ok: true, foods };
}

/** Scales a match to a weight, ready for the confirmation screen. */
export function foodToItem(food: UsdaFood, grams: number): NewItem {
  const factor = grams / 100;
  const round = (n: number) => Math.round(n * factor * 10) / 10;

  return {
    name: food.description,
    quantity: null,
    unit: null,
    grams,
    calories: round(food.per100g.calories),
    protein_g: round(food.per100g.protein_g),
    carbs_g: round(food.per100g.carbs_g),
    fat_g: round(food.per100g.fat_g),
    // A measured reference value scaled by a weight is not an estimate.
    is_estimate: false,
    source_ref: `fdc:${food.fdcId}`,
  };
}

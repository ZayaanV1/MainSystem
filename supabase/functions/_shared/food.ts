/**
 * Turning "2 eggs, 150g chicken breast" into rows.
 *
 * The model is asked for structured output and the provider enforces the
 * schema, and then everything it returns is validated again here. That is not
 * redundancy: a schema guarantees shape, not sense. It will happily return
 * -400 calories, or 900g of protein in an egg, or NaN, and any of those
 * reaching the food log means the day's totals are quietly wrong forever.
 *
 * The rule from CLAUDE.md is absolute — "a malformed model response must never
 * corrupt a day's log" — so nothing here repairs a bad response. It is
 * rejected, the raw text is kept, and the person types it in instead.
 */

export interface ParsedFoodItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** The model's own confidence. Low confidence is shown, never hidden. */
  confident: boolean;
}

export interface ParseWarning {
  item: string;
  message: string;
}

export interface ParseResult {
  items: ParsedFoodItem[];
  warnings: ParseWarning[];
}

/** The shape demanded of the provider. */
export const FOOD_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number', nullable: true },
          unit: { type: 'string', nullable: true },
          grams: { type: 'number', nullable: true },
          calories: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          confident: { type: 'boolean' },
        },
        required: ['name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confident'],
      },
    },
  },
  required: ['items'],
} as const;

export const FOOD_INSTRUCTION = [
  'You convert a description of food eaten into structured nutrition data.',
  'Split the description into one entry per distinct food.',
  'Estimate calories and macros in grams for the quantity actually described,',
  'not per 100g. Where a quantity is not stated, assume one ordinary serving',
  'and set confident to false. Set confident to false whenever the food is',
  'vague, a brand you do not recognise, or a homemade dish whose recipe is',
  'unknown. Never invent a food that was not mentioned. Never merge two foods',
  'into one entry. Return only the JSON.',
].join(' ');

/** Bounds that no single logged item can plausibly exceed. */
const LIMITS = {
  calories: 10_000,
  macro: 2_000,
  grams: 20_000,
  quantity: 1_000,
};

function finiteNonNegative(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > max) return null;
  return Math.round(value * 10) / 10;
}

/**
 * Calories implied by the macros, using 4/4/9.
 *
 * Used to flag rather than reject, because fibre, alcohol and sugar alcohols
 * all break the arithmetic legitimately. A wide tolerance catches the case
 * that matters: a model that returned macros and calories from different
 * foods.
 */
export function impliedCalories(item: ParsedFoodItem): number {
  return item.protein_g * 4 + item.carbs_g * 4 + item.fat_g * 9;
}

/**
 * Validates one item, returning null when it cannot be trusted at all.
 *
 * Anything rejected here is dropped from the parse and reported, so the person
 * sees "I could not read that" rather than silently getting fewer calories
 * than they ate.
 */
export function validateItem(raw: unknown): { item: ParsedFoodItem | null; problem?: string } {
  if (typeof raw !== 'object' || raw === null) return { item: null, problem: 'not an object' };

  const r = raw as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) return { item: null, problem: 'no name' };

  const calories = finiteNonNegative(r.calories, LIMITS.calories);
  const protein = finiteNonNegative(r.protein_g, LIMITS.macro);
  const carbs = finiteNonNegative(r.carbs_g, LIMITS.macro);
  const fat = finiteNonNegative(r.fat_g, LIMITS.macro);

  if (calories === null || protein === null || carbs === null || fat === null) {
    return { item: null, problem: `${name}: impossible numbers` };
  }

  return {
    item: {
      name,
      quantity: finiteNonNegative(r.quantity, LIMITS.quantity),
      unit: typeof r.unit === 'string' && r.unit.trim() ? r.unit.trim() : null,
      grams: finiteNonNegative(r.grams, LIMITS.grams),
      calories,
      protein_g: protein,
      carbs_g: carbs,
      fat_g: fat,
      // Absent or non-boolean confidence is treated as NOT confident. The safe
      // default is the one that shows the person a warning.
      confident: r.confident === true,
    },
  };
}

/**
 * Validates a whole response.
 *
 * Returns whatever survived plus a warning for everything that did not, rather
 * than failing the entire parse on one bad row — losing four good items
 * because the fifth was nonsense would make the feature worse than typing.
 */
export function validateParse(raw: unknown): ParseResult {
  const warnings: ParseWarning[] = [];

  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return { items: [], warnings: [{ item: '', message: 'no items' }] };

  const kept: ParsedFoodItem[] = [];

  for (const candidate of items) {
    const { item, problem } = validateItem(candidate);
    if (!item) {
      warnings.push({ item: '', message: problem ?? 'unreadable' });
      continue;
    }

    if (!item.confident) {
      warnings.push({ item: item.name, message: 'estimated' });
    }

    const implied = impliedCalories(item);
    const stated = item.calories;
    // Only flag a real disagreement, and only when there is enough to compare.
    if (stated > 50 && implied > 50 && Math.abs(implied - stated) / stated > 0.4) {
      warnings.push({
        item: item.name,
        message: `calories and macros disagree — macros imply about ${Math.round(implied)}`,
      });
    }

    kept.push(item);
  }

  return { items: kept, warnings };
}

/** Totals for a set of items. */
export function totals(items: { calories: number; protein_g: number; carbs_g: number; fat_g: number }[]) {
  return items.reduce(
    (acc, i) => ({
      calories: Math.round((acc.calories + i.calories) * 10) / 10,
      protein_g: Math.round((acc.protein_g + i.protein_g) * 10) / 10,
      carbs_g: Math.round((acc.carbs_g + i.carbs_g) * 10) / 10,
      fat_g: Math.round((acc.fat_g + i.fat_g) * 10) / 10,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

/** The fields a food item can arrive with, before it becomes a database row. */
export interface FoodRowInput {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  grams?: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  is_estimate?: boolean;
  source_ref?: string | null;
}

/**
 * Shapes items into rows for a bulk insert into `food_items`.
 *
 * Every key is written on every row, including the ones that are null. This is
 * not tidiness: PostgREST rejects a bulk insert whose objects have differing
 * key sets with PGRST102 "All object keys must match", so a batch where one
 * item carries a `source_ref` and another does not fails as a whole. A parsed
 * meal is exactly that shape — the branded item matched a barcode, the rice
 * did not — so the failure lands on real input rather than on an edge case.
 *
 * It lives here rather than inline in the caller so the property is testable,
 * and so the client and any server-side write agree on one row shape.
 * Replacing this with a spread of the caller's objects reintroduces the bug
 * silently: it only fails once two items in one meal differ.
 */
export function itemRows(userId: string, entryId: string, items: FoodRowInput[]) {
  return items.map((i, position) => ({
    user_id: userId,
    entry_id: entryId,
    name: i.name.trim(),
    quantity: i.quantity ?? null,
    unit: i.unit ?? null,
    grams: i.grams ?? null,
    calories: i.calories,
    protein_g: i.protein_g,
    carbs_g: i.carbs_g,
    fat_g: i.fat_g,
    is_estimate: i.is_estimate ?? false,
    source_ref: i.source_ref ?? null,
    position,
  }));
}

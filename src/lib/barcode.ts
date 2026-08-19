import type { NewItem } from './diet';

/**
 * Barcode lookup, via Open Food Facts.
 *
 * No key, no account, no paid tier — which is why it is here rather than a
 * commercial nutrition API. The data is crowd-sourced and therefore uneven:
 * some products carry a full panel, some carry a name and nothing else. A
 * product with no usable macros is reported as not found rather than returned
 * as a row of zeroes, because a zero that looks like data is worse than a
 * miss.
 *
 * Everything comes back per 100g and is scaled by the weight entered. That is
 * how the label is written, and scaling a weighed amount is exact where
 * guessing at "one serving" is not.
 */

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

/** Identifies the app to Open Food Facts, which their terms ask for. */
const USER_AGENT = 'life-planner/0.1 (personal use)';

export interface BarcodeProduct {
  code: string;
  name: string;
  brand: string | null;
  /** Per 100 g, always. */
  per100g: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  /** Grams in one serving, where the product states it. */
  servingGrams: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Reads a product out of an Open Food Facts response.
 *
 * Split from the fetch so the awkward cases can be tested without the network,
 * and there are many: missing nutriments, energy in kJ only, serving sizes
 * written as "1 portion (330 ml)".
 */
export function readProduct(body: unknown): BarcodeProduct | null {
  const root = body as { status?: number; code?: string; product?: Record<string, unknown> };
  if (root?.status !== 1 || !root.product) return null;

  const p = root.product;
  const n = (p.nutriments ?? {}) as Record<string, unknown>;

  // kcal where given; otherwise convert from kJ rather than dropping the
  // product, since European labels frequently carry only kJ.
  const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy-kj_100g']) !== null
    ? Math.round((num(n['energy-kj_100g']) as number) / 4.184)
    : null);

  const protein = num(n.proteins_100g);
  const carbs = num(n.carbohydrates_100g);
  const fat = num(n.fat_100g);

  // A name alone is not a food entry. Without energy and at least one macro
  // there is nothing to log, so this counts as a miss.
  if (kcal === null || (protein === null && carbs === null && fat === null)) return null;

  const name = String(p.product_name ?? '').trim();
  if (!name) return null;

  const brand = String(p.brands ?? '').split(',')[0].trim() || null;

  return {
    code: String(root.code ?? ''),
    name,
    brand,
    per100g: {
      calories: kcal,
      protein_g: protein ?? 0,
      carbs_g: carbs ?? 0,
      fat_g: fat ?? 0,
    },
    servingGrams: readServingGrams(p.serving_size),
  };
}

/**
 * Grams in a stated serving.
 *
 * Only grams are read. "330 ml" is left alone deliberately: millilitres are
 * grams only for water, and quietly treating a serving of oil as if it were
 * would put a wrong number in the log with no sign anything was assumed.
 */
export function readServingGrams(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/([\d.]+)\s*g\b/i);
  if (!match) return null;
  const grams = Number(match[1]);
  return Number.isFinite(grams) && grams > 0 && grams < 5000 ? grams : null;
}

/** A barcode is 8 to 14 digits; anything else is not worth a request. */
export function isBarcode(input: string): boolean {
  return /^\d{8,14}$/.test(input.trim());
}

export type BarcodeResult =
  | { ok: true; product: BarcodeProduct }
  | { ok: false; reason: string };

export async function lookupBarcode(code: string): Promise<BarcodeResult> {
  const clean = code.trim();
  if (!isBarcode(clean)) return { ok: false, reason: 'That is not a barcode. It should be 8 to 14 digits.' };

  let res: Response;
  try {
    res = await fetch(
      `${ENDPOINT}/${clean}?fields=product_name,brands,nutriments,serving_size`,
      { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
    );
  } catch {
    return { ok: false, reason: "Couldn't reach the food database. Add it by hand, or try again." };
  }

  if (!res.ok) {
    return { ok: false, reason: `The food database returned ${res.status}. Add it by hand.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'The food database returned something unreadable. Add it by hand.' };
  }

  const product = readProduct(body);
  if (!product) {
    return { ok: false, reason: 'Not in the food database, or it has no nutrition panel. Add it by hand.' };
  }

  return { ok: true, product };
}

/** Scales a product to a weight, ready for the confirmation screen. */
export function productToItem(product: BarcodeProduct, grams: number): NewItem {
  const factor = grams / 100;
  const round = (n: number) => Math.round(n * factor * 10) / 10;

  // The brand is appended only when it adds something. Open Food Facts often
  // repeats the product name in the brands field, and "Nutella (Nutella)" is
  // noise where "Nutella (Ferrero)" is a distinction worth having.
  const brandAdds =
    product.brand && product.brand.toLowerCase() !== product.name.toLowerCase();

  return {
    name: brandAdds ? `${product.name} (${product.brand})` : product.name,
    quantity: null,
    unit: null,
    grams,
    calories: round(product.per100g.calories),
    protein_g: round(product.per100g.protein_g),
    carbs_g: round(product.per100g.carbs_g),
    fat_g: round(product.per100g.fat_g),
    // Not an estimate: this is a label, scaled by a weight. It is the most
    // exact number in the whole app.
    is_estimate: false,
    source_ref: `off:${product.code}`,
  };
}

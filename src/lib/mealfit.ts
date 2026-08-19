import type { MacroBand, NewItem, SavedMeal } from './diet';

/**
 * Which saved meals actually fit what is left of the day.
 *
 * From the spec: "At 6pm the app knows I need 62g of protein and 900 calories
 * — surface the saved meals that actually fit."
 *
 * No model is involved. This is arithmetic over data the app already has, and
 * routing it through an LLM would spend a shared free-tier quota to answer a
 * question that subtraction answers exactly. It also means this keeps working
 * when the quota is gone, which is when a tired person most needs the answer.
 *
 * "Fit" weighs a protein shortfall three times as heavily as anything else.
 * Protein is the macro with a floor that is actually hard to reach; calories
 * are a range you land in over a week. A meal that overshoots calories a
 * little and closes a 60 g protein gap is a good suggestion, and a scoring
 * function that punished it equally for both would rank it below something
 * useless.
 *
 * But both targets are bands with a top, and the app enforces the calorie one.
 * Ignoring the protein one produced a real bad suggestion the first time this
 * ran against a real day: it offered 1.5 portions to fill the calorie gap and
 * put protein 26 g past the ceiling, when a single portion landed protein
 * squarely in range. Going over is far less bad than falling short, so it
 * carries a third of the weight — not none.
 */

export interface Remaining {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface MealFit {
  meal: SavedMeal;
  /** The portion that fits best, from the same set the UI offers. */
  portion: number;
  /** Lower is better. Unitless; only the ordering is meaningful. */
  score: number;
  /** Protein at the chosen portion. Breaks ties between equal scores. */
  protein_g: number;
  /** Written reason, because a ranked list with no explanation is a guess. */
  why: string;
}

/** The portions the food screen offers. Suggesting 0.7 would be unusable. */
const PORTIONS = [0.5, 1, 1.5, 2] as const;

const sum = (items: NewItem[], key: keyof Pick<NewItem, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'>) =>
  items.reduce((n, i) => n + (i[key] ?? 0), 0);

/**
 * What is left before the bottom of each target band.
 *
 * Measured against the band's minimum, not its midpoint or maximum: the
 * question at 6pm is "what do I still have to eat", and the bottom of the
 * range is the answer. Never negative — once you are in range there is no
 * gap, and a negative would invert the scoring.
 */
export function remainingToday(
  totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number },
  targets: { calories: MacroBand; protein: MacroBand; carbs: MacroBand; fat: MacroBand } | null,
): Remaining | null {
  if (!targets) return null;

  return {
    calories: Math.max(0, targets.calories.min - totals.calories),
    protein_g: Math.max(0, targets.protein.min - totals.protein_g),
    carbs_g: Math.max(0, targets.carbs.min - totals.carbs_g),
    fat_g: Math.max(0, targets.fat.min - totals.fat_g),
  };
}

/**
 * Ranks saved meals against what is left.
 *
 * Returns nothing when nothing is left, rather than suggesting food to someone
 * who has already eaten enough. That silence is deliberate: the feature exists
 * to answer a question, not to prompt eating.
 */
/**
 * Headroom before the TOP of each band.
 *
 * An object rather than positional arguments: they are both nullable numbers
 * with a `limit` behind them, and the first time this signature grew, a call
 * silently passed the limit as a ceiling and reordered the whole list. Named
 * fields make that mistake impossible to write.
 */
export interface Ceilings {
  /** Calories left before the top of the band. A hard limit. */
  calories: number | null;
  /** Protein left before the top of its band. Soft, but not ignored. */
  protein?: number | null;
}

export function suggestMeals(
  meals: SavedMeal[],
  remaining: Remaining | null,
  ceilings: Ceilings,
  limit = 3,
): MealFit[] {
  const calorieCeiling = ceilings.calories;
  const proteinCeiling = ceilings.protein ?? null;

  if (!remaining) return [];
  if (remaining.protein_g <= 0 && remaining.calories <= 0) return [];

  const fits: MealFit[] = [];

  for (const meal of meals) {
    const items = meal.items as unknown as NewItem[];
    if (!items?.length) continue;

    const base = {
      calories: sum(items, 'calories'),
      protein_g: sum(items, 'protein_g'),
    };
    if (base.calories <= 0 && base.protein_g <= 0) continue;

    let best: MealFit | null = null;

    for (const portion of PORTIONS) {
      const cals = base.calories * portion;
      const protein = base.protein_g * portion;

      // Overshooting the top of the calorie band is the one hard limit. A
      // suggestion that puts the day 500 over is not a suggestion.
      if (calorieCeiling !== null && cals > calorieCeiling) continue;

      // Protein shortfall is weighted three times a calorie shortfall of the
      // same proportion, and going OVER on protein is not penalised at all —
      // there is no upper problem with hitting protein early.
      const proteinGap = remaining.protein_g > 0
        ? Math.max(0, remaining.protein_g - protein) / remaining.protein_g
        : 0;
      const calorieMiss = remaining.calories > 0
        ? Math.abs(remaining.calories - cals) / remaining.calories
        : cals / 500;

      // Overshooting the protein ceiling costs a third of what falling short
      // of the floor does. Enough to prefer the portion that lands in the
      // band, never enough to prefer one that misses the floor.
      const proteinOver = proteinCeiling !== null && proteinCeiling > 0
        ? Math.max(0, protein - proteinCeiling) / proteinCeiling
        : 0;

      const score = proteinGap * 3 + proteinOver + calorieMiss;

      if (!best || score < best.score) {
        best = {
          meal,
          portion,
          score,
          protein_g: Math.round(protein * 10) / 10,
          why: explain(protein, cals, remaining),
        };
      }
    }

    if (best) fits.push(best);
  }

  // Ties are real: two meals of the same calories that both clear the protein
  // gap score identically, because overshooting protein carries no penalty.
  // Broken toward more protein, which is the point of a lean bulk and the
  // reason "no penalty" is not the same as "no preference".
  return fits
    .sort((a, b) => (a.score !== b.score ? a.score - b.score : b.protein_g - a.protein_g))
    .slice(0, limit);
}

/**
 * Says what the meal does to the gap, in numbers.
 *
 * "Covers the protein" is a claim; "34 g of the 62 g left" is the same claim
 * with its evidence attached, and the second one can be disagreed with.
 */
function explain(protein: number, calories: number, remaining: Remaining): string {
  const p = Math.round(protein);
  const c = Math.round(calories);

  if (remaining.protein_g <= 0) return `${c} kcal, ${p} g protein`;

  const gap = Math.round(remaining.protein_g);
  return p >= gap
    ? `Covers the ${gap} g of protein left, ${c} kcal`
    : `${p} g of the ${gap} g protein left, ${c} kcal`;
}

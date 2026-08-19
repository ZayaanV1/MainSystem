import { describe, it, expect } from 'vitest';
import { foodToItem, readFood } from './usda';

/**
 * Built from real FoodData Central responses. Both of the awkward cases here
 * were found by calling the live API, not by reading the docs.
 */

const food = (nutrients: { nutrientNumber: string; value: number; unitName: string }[]) => ({
  fdcId: 2646170,
  description: 'Chicken, breast, boneless, skinless, raw',
  dataType: 'Foundation',
  foodNutrients: nutrients,
});

const g = (nutrientNumber: string, value: number) => ({ nutrientNumber, value, unitName: 'G' });
const kcal = (nutrientNumber: string, value: number) => ({ nutrientNumber, value, unitName: 'KCAL' });

describe('readFood', () => {
  it('reads a food with the plain energy field', () => {
    const f = readFood(food([kcal('208', 172), g('203', 20.8), g('205', 0), g('204', 9.25)]));
    // 9.25 rounds to 9.3: macros are stored to one decimal so a day of them
    // does not accumulate float error.
    expect(f?.per100g).toEqual({ calories: 172, protein_g: 20.8, carbs_g: 0, fat_g: 9.3 });
  });

  it('falls back to the Atwater factors when 208 is absent', () => {
    // This is the real shape of a Foundation food. Reading only 208 would
    // silently drop the two best matches for "chicken breast raw".
    const f = readFood(
      food([g('203', 22.5), g('204', 1.93), g('205', 0), kcal('957', 106), kcal('958', 112)]),
    );
    // Specific factors are preferred over general: per-food coefficients
    // rather than a flat 4/4/9.
    expect(f?.per100g.calories).toBe(112);
  });

  it('clamps the negative carbohydrate the by-difference method produces', () => {
    // A real response returns -0.428 g of carbohydrate for chicken breast.
    // It is an artifact of subtracting everything else from the total mass.
    const f = readFood(food([kcal('208', 120), g('203', 21.4), g('205', -0.428), g('204', 4.78)]));
    expect(f?.per100g.carbs_g).toBe(0);
  });

  it('treats a large negative as missing rather than clamping it', () => {
    // Below -1 g is no longer a rounding artifact, and there is no honest way
    // to guess what it should have been.
    const f = readFood(food([kcal('208', 120), g('203', 21.4), g('205', -40), g('204', 4.78)]));
    expect(f?.per100g.carbs_g).toBe(0);
    expect(f?.per100g.protein_g).toBe(21.4);
  });

  it('refuses a value in the wrong unit rather than reading it as grams', () => {
    // Milligrams read as grams would inflate a macro a thousandfold and still
    // look almost plausible on the ring.
    const f = readFood(
      food([kcal('208', 120), { nutrientNumber: '203', value: 21400, unitName: 'MG' }, g('204', 4)]),
    );
    expect(f?.per100g.protein_g).toBe(0);
  });

  it('is a miss when there is no energy at all', () => {
    expect(readFood(food([g('203', 21), g('204', 4)]))).toBeNull();
  });

  it('is a miss when there are no macros at all', () => {
    expect(readFood(food([kcal('208', 120)]))).toBeNull();
  });

  it('is a miss without an id or a description', () => {
    expect(readFood({ description: 'Thing', foodNutrients: [kcal('208', 1), g('203', 1)] })).toBeNull();
    expect(readFood({ fdcId: 1, description: '  ', foodNutrients: [kcal('208', 1), g('203', 1)] })).toBeNull();
  });
});

describe('foodToItem', () => {
  const chicken = {
    fdcId: 2646170,
    description: 'Chicken, breast, boneless, skinless, raw',
    dataType: 'Foundation',
    per100g: { calories: 112, protein_g: 22.5, carbs_g: 0, fat_g: 1.9 },
  };

  it('scales the reference values by the weight entered', () => {
    const item = foodToItem(chicken, 150);
    expect(item.calories).toBe(168);
    expect(item.protein_g).toBe(33.8);
    expect(item.grams).toBe(150);
  });

  it('is not marked as an estimate', () => {
    expect(foodToItem(chicken, 150).is_estimate).toBe(false);
  });

  it('records the FDC id it came from', () => {
    expect(foodToItem(chicken, 150).source_ref).toBe('fdc:2646170');
  });
});

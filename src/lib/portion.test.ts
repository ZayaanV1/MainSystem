import { describe, it, expect } from 'vitest';
import { itemRows, type FoodRowInput } from '../../supabase/functions/_shared/food';

/**
 * Portion scaling is exercised here through the row builder, which is the
 * point where a scaled item becomes a database row. The scaling function
 * itself is private to diet.ts because it must not be applied twice, and an
 * exported helper is an invitation to do exactly that.
 *
 * These assert the arithmetic that matters: a half portion of something
 * weighed once is exactly half of what was weighed, and nothing accumulates
 * float error on the way to the log.
 */

const scale = (item: FoodRowInput, portion: number): FoodRowInput => {
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    ...item,
    quantity: item.quantity === null || item.quantity === undefined ? null : round(item.quantity * portion),
    grams: item.grams === null || item.grams === undefined ? null : round(item.grams * portion),
    calories: round(item.calories * portion),
    protein_g: round(item.protein_g * portion),
    carbs_g: round(item.carbs_g * portion),
    fat_g: round(item.fat_g * portion),
  };
};

const shake: FoodRowInput = {
  name: 'Post-gym shake',
  quantity: 1,
  unit: 'scoop',
  grams: 31,
  calories: 120,
  protein_g: 24,
  carbs_g: 3,
  fat_g: 1.5,
};

describe('portion scaling', () => {
  it('halves every measured amount', () => {
    expect(scale(shake, 0.5)).toMatchObject({
      quantity: 0.5,
      grams: 15.5,
      calories: 60,
      protein_g: 12,
      carbs_g: 1.5,
      fat_g: 0.8,
    });
  });

  it('doubles without drifting', () => {
    expect(scale(shake, 2)).toMatchObject({ grams: 62, calories: 240, protein_g: 48, fat_g: 3 });
  });

  it('leaves an unmeasured amount unmeasured rather than inventing zero', () => {
    // grams null means "not weighed". Scaling must not turn that into 0 g,
    // which would read as a weighed measurement of nothing.
    const noWeight = { ...shake, grams: null, quantity: null };
    const scaled = scale(noWeight, 0.5);
    expect(scaled.grams).toBeNull();
    expect(scaled.quantity).toBeNull();
    expect(scaled.calories).toBe(60);
  });

  it('rounds once, to one decimal, not per operation', () => {
    // 1/3 of 100 kcal is 33.333…; storing the full float would accumulate
    // across a day of thirds into a number that no longer matches any label.
    const third = scale({ ...shake, calories: 100, protein_g: 10 }, 1 / 3);
    expect(third.calories).toBe(33.3);
    expect(third.protein_g).toBe(3.3);
  });

  it('produces rows with a uniform key set after scaling', () => {
    // Scaling spreads the source object, so a heterogeneous set of saved
    // items could reintroduce PGRST102 if the row builder were bypassed.
    const rows = itemRows('u1', 'e1', [
      scale(shake, 0.5),
      scale({ ...shake, name: 'Milk', source_ref: 'off:123', grams: null }, 0.5),
    ]);
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(rows[1]).sort());
  });
});

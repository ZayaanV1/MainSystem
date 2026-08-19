import { describe, it, expect } from 'vitest';
import { itemRows, type FoodRowInput } from '../../supabase/functions/_shared/food';

/**
 * Payload shaping only. Everything else in diet.ts is a Supabase round trip,
 * and a mocked round trip would assert that the mock behaves like the mock
 * rather than that the database accepts the write.
 */

const item = (o: Partial<FoodRowInput>): FoodRowInput => ({
  name: 'Rice',
  calories: 390,
  protein_g: 8.1,
  carbs_g: 84,
  fat_g: 0.9,
  ...o,
});

describe('itemRows', () => {
  it('gives every row an identical key set', () => {
    // The real failure this guards against, found by seeding a live day: one
    // item matched a barcode and carried source_ref, the other did not, and
    // PostgREST rejected the whole batch with PGRST102 "All object keys must
    // match". The entry was created, the items were not, and the day read
    // 758 kcal instead of 1,244 with nothing on screen to say why.
    const rows = itemRows('u1', 'e1', [
      item({ name: 'Eggs, 2 large', quantity: 2, unit: 'large' }),
      item({ name: 'Natrel 2% milk', grams: 515, source_ref: 'off:0059749877015' }),
      item({ name: 'Whey, 1 scoop', is_estimate: true }),
    ]);

    const shape = Object.keys(rows[0]).sort();
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(shape);
    }
  });

  it('writes absent optional fields as null rather than omitting them', () => {
    const [row] = itemRows('u1', 'e1', [item({})]);

    expect(row).toMatchObject({
      user_id: 'u1',
      entry_id: 'e1',
      quantity: null,
      unit: null,
      grams: null,
      source_ref: null,
      is_estimate: false,
    });
    // Omission and null are different to PostgREST; only null is safe here.
    expect(Object.hasOwn(row, 'source_ref')).toBe(true);
    expect(Object.hasOwn(row, 'grams')).toBe(true);
  });

  it('numbers positions in the order given, so a meal reads back as logged', () => {
    const rows = itemRows('u1', 'e1', [
      item({ name: 'First' }),
      item({ name: 'Second' }),
      item({ name: 'Third' }),
    ]);
    expect(rows.map((r) => [r.name, r.position])).toEqual([
      ['First', 0],
      ['Second', 1],
      ['Third', 2],
    ]);
  });

  it('trims the name but leaves the macros exactly as measured', () => {
    const [row] = itemRows('u1', 'e1', [item({ name: '  Chicken breast \n', protein_g: 46.5 })]);
    expect(row.name).toBe('Chicken breast');
    expect(row.protein_g).toBe(46.5);
  });
});
